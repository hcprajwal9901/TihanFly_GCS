#include "serial.h"

#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#endif


SerialTransport::SerialTransport(asio::io_context& io,
                                 const std::string& port,
                                 int baudrate)
    : serial_(io), baudrate_(baudrate)
{
    try {
        serial_.open(port);
        serial_.set_option(asio::serial_port_base::baud_rate(baudrate));

        // Expand the OS-level serial RX buffer via the native platform API.
        // asio::socket_base::receive_buffer_size is a *socket* option and
        // does NOT compile for asio::serial_port — use the correct API instead.
#ifdef _WIN32
        // SetupComm() requests a 64 KB RX queue from the Windows serial driver.
        // This prevents overflow when ArduPilot streams the full ~30 KB param
        // burst faster than the io_context can re-arm async_read_some.
        SetupComm(serial_.native_handle(), 65536, 4096);
#endif
        // Linux: the kernel tty buffer (typically 4 KB) cannot be enlarged from
        // user-space.  The 64 KB application-level buffer in do_receive() absorbs
        // the burst without loss.

        std::cout << "[Serial] Opened " << port << " at " << baudrate << " baud\n";
    } catch (...) {
        std::cout << "[Serial] Failed to open " << port << "\n";
    }
}

int SerialTransport::get_baudrate() const
{
    return baudrate_;
}

void SerialTransport::start()
{
    do_receive();
}

void SerialTransport::async_send(const uint8_t* data, std::size_t length)
{
    if (!serial_.is_open()) return;

    asio::async_write(serial_,
        asio::buffer(data, length),
        [](auto, auto){});
}

void SerialTransport::set_receive_callback(ReceiveCallback cb)
{
    callback_ = cb;
}

void SerialTransport::stop()
{
    if (serial_.is_open())
        serial_.close();
}

bool SerialTransport::is_open() const
{
    return serial_.is_open();
}

bool SerialTransport::is_active()
{
    if (!active_) return false;

    auto now  = std::chrono::steady_clock::now();
    auto diff = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - last_receive_).count();

    return diff < 2000;
}

void SerialTransport::do_receive()
{
    auto read_buf = std::make_shared<std::vector<uint8_t>>(RECV_BUF_SIZE);

    serial_.async_read_some(
        asio::buffer(read_buf->data(), read_buf->size()),
        [this, read_buf](std::error_code ec, std::size_t len)
        {
            if (ec)
            {
                // Port was closed (stop() called) or a hardware error occurred.
                // Do NOT re-arm — spinning on a closed/errored port wastes CPU.
                // IMPORTANT: close the port on any real error so the serial
                // monitor thread detects it as gone and reopens it cleanly.
                // Without this close(), the port stays zombie-open in
                // g_serial_ports and is never recovered after a USB glitch.
                if (ec == asio::error::operation_aborted)
                {
                    // Normal shutdown via stop() — port already closed.
                    return;
                }
                std::cout << "[Serial] Receive error: " << ec.message()
                          << " — closing port for monitor to reopen\n";
                asio::error_code close_ec;
                serial_.close(close_ec);
                return;
            }

            // Immediately re-arm the next async read before calling the callback!
            // This ensures the OS-level serial queue is continuously emptied even if the
            // callback takes time (e.g. processing MAVLink messages or WebSocket writes).
            do_receive();

            if (len > 0)
            {
                active_       = true;
                last_receive_ = std::chrono::steady_clock::now();

                if (callback_)
                    callback_(read_buf->data(), len);
            }
        });
}