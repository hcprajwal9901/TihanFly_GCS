#include <iostream>
#include <thread>

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

typedef websocketpp::server<websocketpp::config::asio> websocket_server;

websocket_server ws_server;

void start_websocket_server()
{
    ws_server.init_asio();

    ws_server.set_open_handler([](websocketpp::connection_hdl hdl) {
        std::cout << "[WebSocket] Client connected" << std::endl;
    });

    ws_server.set_close_handler([](websocketpp::connection_hdl hdl) {
        std::cout << "[WebSocket] Client disconnected" << std::endl;
    });

    ws_server.set_message_handler(
        [](websocketpp::connection_hdl hdl, websocket_server::message_ptr msg)
        {
            std::string payload = msg->get_payload();

            std::cout << "[Frontend] " << payload << std::endl;

            // ✅ Send response (matches your frontend format)
            std::string response = R"({
                "type": "status",
                "result": "command_received"
            })";

            ws_server.send(hdl, response, websocketpp::frame::opcode::text);
        });

    ws_server.listen(9002);
    ws_server.start_accept();

    std::thread([]() {
        ws_server.run();
    }).detach();

    std::cout << "[WebSocket] Running on port 9002" << std::endl;
}