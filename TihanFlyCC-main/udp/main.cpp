#include<iostream>
#include<asio.hpp>
#include<udp.h>
#include <mavlink/ardupilotmega/mavlink.h>

void heartbeat(asio::steady_timer& timer,
               std::shared_ptr<udp_socket> socket_ptr)
{
    timer.expires_after(std::chrono::milliseconds(1000));
    timer.async_wait([socket_ptr, &timer](const std::error_code& ec){
        if (!ec)
        {
            mavlink_heartbeat_t heartbeat_msg{};
            heartbeat_msg.type = MAV_TYPE_GCS;
            heartbeat_msg.autopilot = MAV_AUTOPILOT_INVALID;
            heartbeat_msg.base_mode = 0;
            heartbeat_msg.custom_mode = 0;
            heartbeat_msg.system_status = MAV_STATE_ACTIVE;
            heartbeat_msg.mavlink_version = 3;

            mavlink_message_t msg;
            mavlink_msg_heartbeat_encode(255, 190, &msg, &heartbeat_msg);

            uint8_t buffer[300];
            size_t len = mavlink_msg_to_send_buffer(buffer, &msg);

            socket_ptr->send(buffer, len);

            heartbeat(timer, socket_ptr);
        }
    });
}

void send_arm(std::shared_ptr<udp_socket> socket,
              uint8_t target_sysid,
              uint8_t target_compid)
{
    mavlink_command_long_t cmd{};
    cmd.command = MAV_CMD_COMPONENT_ARM_DISARM;
    cmd.target_system = target_sysid;
    cmd.target_component = target_compid;
    cmd.confirmation = 0;
    cmd.param1 = 1; // ARM

    mavlink_message_t msg;
    mavlink_msg_command_long_encode(255, 190, &msg, &cmd);

    uint8_t buffer[128];
    size_t len = mavlink_msg_to_send_buffer(buffer, &msg);

    std::cout << "Sending ARM command..." << std::endl;
    socket->send(buffer, len);
}


void send_takeoff(std::shared_ptr<udp_socket> socket,
                  uint8_t target_sysid,
                  uint8_t target_compid,
                  float altitude)
{
    mavlink_command_long_t cmd{};
    cmd.command = MAV_CMD_NAV_TAKEOFF;
    cmd.target_system = target_sysid;
    cmd.target_component = target_compid;
    cmd.confirmation = 0;
    cmd.param7 = altitude; // Target altitude

    mavlink_message_t msg;
    mavlink_msg_command_long_encode(255, 190, &msg, &cmd);

    uint8_t buffer[128];
    size_t len = mavlink_msg_to_send_buffer(buffer, &msg);

    std::cout << "Sending TAKEOFF command to " << altitude << " meters..." << std::endl;
    socket->send(buffer, len);
}


/*int main(){

    //asio::io_context io;

    // udp::socket socket(io, udp::endpoint(udp::v4(), 14550));

    // char buffer[2048];
    // udp::endpoint sender;

    // size_t len = socket.receive_from(asio::buffer(buffer),sender);

    // std::cout << "Recived " << len << " bytes from "<< sender.address() << " "<<sender.port() <<" " << std::endl;
    // std::cout.write(buffer,len);
    // std::string msg("Hello\n");
    // len = msg.length();
    // socket.async_send_to(asio::buffer(msg,len),sender,
    //     [&](const std::error_code& ec,std::size_t){
    //         if(ec){
    //             std::cout << "Send Failed\r" << ec.message()<<std::endl;
    //             return;
    //         }

    //     }
    // );
    // mavlink_status_t status;
    // mavlink_message_t msg;
    // int chan = MAVLINK_COMM_0;

    // std::shared_ptr<udp_socket> socket = std::make_shared<udp_socket>(io,14550);
    // socket->on_data_recived_ =
    //     [&](const std::error_code& ec, size_t len, const uint8_t* data){
    //         if(ec){
    //             std::cout << "Receive Failed\r" << ec.message()<<std::endl;
    //             return;
    //         }
    //         int visible_sats = 0;
    //         //std::cout << "Recived " << len << " bytes "<< std::endl;
    //         for(size_t i=0;i<len;i++)
    //         {
    //         if (mavlink_parse_char(chan, data[i], &msg, &status))
    //         {   
                
    //             mavlink_global_position_int_t global_position;
    //             mavlink_heartbeat_t heartbeat;
    //                 switch(msg.msgid) {
    //                   case MAVLINK_MSG_ID_GLOBAL_POSITION_INT: // ID for GLOBAL_POSITION_INT
    //                     {
    //                       // Get all fields in payload (into global_position)
    //                       mavlink_msg_global_position_int_decode(&msg, &global_position);
    //                       std::cout << "Parsed message with ID: " << msg.msgid << " Speed: " << global_position.vz << std::endl;
                        
    //                     }
    //                     break;
    //                   case MAVLINK_MSG_ID_GPS_STATUS:
    //                     {
    //                       // Get just one field from payload
    //                       visible_sats = mavlink_msg_gps_status_get_satellites_visible(&msg);
    //                     }
    //                     break;
    //                   case MAVLINK_MSG_ID_HEARTBEAT:
    //                     {
    //                       // Just an example of another message you might want to handle
    //                       std::cout << "Heartbeat message received."<< msg.msgid << std::endl;
    //                       mavlink_msg_heartbeat_decode(&msg, &heartbeat);
    //                       std::cout << "System status: " << static_cast<int>(heartbeat.system_status) << std::endl;
    //                       std::cout << "Type: " << static_cast<int>(heartbeat.type) << std::endl;
    //                       std::cout << "Autopilot: " << static_cast<int>(heartbeat.autopilot) << std::endl;
    //                     }
    //                     break;
    //                  default:
    //                     break;
    //                 }
                
    //         }
    //         }

    //         //std::cout.write((const char*)data,len);
            

    //     };

    //     socket->on_data_sent_ =
    //     [&](const std::error_code& ec,std::size_t bytes_sent){
    //         if(ec){
    //             std::cout << "Send Failed\r" << ec.message()<<std::endl;
    //             return;
    //         }
    //         std::cout << "Sent " << bytes_sent << " bytes "<< std::endl;
    //     };
        
        
        
    //     //socket->send((const uint8_t *)"Hello from UDP Client",22);

    // socket->start_receive();
    // asio::steady_timer timer(io);
    // io.run(); 
    // std::this_thread::sleep_for(std::chrono::seconds(1));
    // heartbeat(timer,socket);
    
    
    asio::io_context io;

    mavlink_status_t status{};
    mavlink_message_t msg{};
    int chan = MAVLINK_COMM_0;

    auto socket = std::make_shared<udp_socket>(io, 14550);

    // ---- Connection state (TEMP) ----
    bool connected = false;
    uint8_t autopilot_sysid = 0;
    uint8_t autopilot_compid = 0;

    asio::steady_timer heartbeat_timer(io);

    socket->on_data_recived_ =
        [&](const std::error_code& ec, size_t len, const uint8_t* data)
        {
            if (ec) {
                std::cout << "Receive failed: " << ec.message() << std::endl;
                return;
            }

            for (size_t i = 0; i < len; i++)
            {
                if (mavlink_parse_char(chan, data[i], &msg, &status))
                {
                    if (msg.msgid == MAVLINK_MSG_ID_HEARTBEAT)
                    {
                        mavlink_heartbeat_t hb;
                        mavlink_msg_heartbeat_decode(&msg, &hb);

                        std::cout << "Heartbeat from SYS "
                                  << int(msg.sysid)
                                  << " COMP "
                                  << int(msg.compid) << std::endl;

                        // ---- FIRST HEARTBEAT = CONNECTION ----
                        if (!connected && hb.autopilot != MAV_AUTOPILOT_INVALID)
                        {
                            connected = true;
                            autopilot_sysid  = msg.sysid;
                            autopilot_compid = msg.compid;

                            std::cout << "CONNECTED to autopilot "
                                      << int(autopilot_sysid) << ":"
                                      << int(autopilot_compid) << std::endl;

                            // ---- Start GCS heartbeat ONLY AFTER CONNECT ----
                            heartbeat(heartbeat_timer, socket);
                        }
                    }
                }
            }
        };

    socket->on_data_sent_ =
        [&](const std::error_code& ec, std::size_t bytes_sent)
        {
            if (ec) {
                std::cout << "Send failed: " << ec.message() << std::endl;
                return;
            }
            std::cout << "Sent " << bytes_sent << " bytes" << std::endl;
        };

    // ---- Start receiving FIRST ----
    socket->start_receive();

    // ---- Run event loop (blocks forever) ----
    io.run();

    
    return 0;
}*/

int main()
{
    asio::io_context io;

    mavlink_status_t status{};
    mavlink_message_t msg{};
    int chan = MAVLINK_COMM_0;

    auto socket = std::make_shared<udp_socket>(io, 14550);

    bool connected = false;
    bool arm_sent = false;
    uint8_t autopilot_sysid = 0;
    uint8_t autopilot_compid = 0;

    asio::steady_timer heartbeat_timer(io);
    asio::steady_timer arm_timer(io);

    socket->on_data_recived_ =
        [&](const std::error_code& ec, size_t len, const uint8_t* data)
        {
            if (ec) {
                std::cout << "Receive failed: " << ec.message() << std::endl;
                return;
            }

            for (size_t i = 0; i < len; i++)
            {
                if (mavlink_parse_char(chan, data[i], &msg, &status))
                {
                    switch (msg.msgid)
                    {
                        case MAVLINK_MSG_ID_HEARTBEAT:
                        {
                            mavlink_heartbeat_t hb;
                            mavlink_msg_heartbeat_decode(&msg, &hb);

                            std::cout << "Heartbeat from SYS "
                                      << int(msg.sysid)
                                      << " COMP "
                                      << int(msg.compid) << std::endl;

                            if (!connected && hb.autopilot != MAV_AUTOPILOT_INVALID)
                            {
                                connected = true;
                                autopilot_sysid  = msg.sysid;
                                autopilot_compid = msg.compid;

                                std::cout << "CONNECTED to autopilot "
                                          << int(autopilot_sysid) << ":"
                                          << int(autopilot_compid) << std::endl;

                                // Start GCS heartbeat
                                //heartbeat(heartbeat_timer, socket);

                                // ARM after 1 second (TEMP, SAFE)
                                arm_timer.expires_after(std::chrono::seconds(1));
                                arm_timer.async_wait(
                                    [socket, &arm_sent,
                                     autopilot_sysid, autopilot_compid]
                                    (const std::error_code& ec)
                                    {
                                        if (!ec && !arm_sent)
                                        {
                                            send_arm(socket,
                                                     autopilot_sysid,
                                                     autopilot_compid);
                                            arm_sent = true;
                                        }
                                    });
                            }
                            break;
                        }

                        case MAVLINK_MSG_ID_COMMAND_ACK:
                        {
                            mavlink_command_ack_t ack;
                            mavlink_msg_command_ack_decode(&msg, &ack);

                            if (ack.command == MAV_CMD_COMPONENT_ARM_DISARM)
                            {
                                std::cout << "ARM ACK result: "
                                          << int(ack.result) << std::endl;

                                send_takeoff(socket,
                                             autopilot_sysid,
                                             autopilot_compid,
                                             10.0f); // Takeoff to 10 meters
                            }


                            break;
                        }

                        case MAVLINK_MSG_ID_LOCAL_POSITION_NED:
                        {
                            mavlink_local_position_ned_t local_pos;
                            mavlink_msg_local_position_ned_decode(&msg, &local_pos);

                            std::cout << "Local Position NED - X: "
                                      << local_pos.x << " Y: "
                                      << local_pos.y << " Z: "
                                      << local_pos.z << std::endl;
                            break;
                        }

                        default:
                            break;
                    }
                }
            }
        };

    socket->on_data_sent_ =
        [&](const std::error_code& ec, std::size_t bytes_sent)
        {
            if (ec) {
                std::cout << "Send failed: " << ec.message() << std::endl;
                return;
            }
            std::cout << "Sent " << bytes_sent << " bytes" << std::endl;
        };

    socket->start_receive();
    io.run();
    return 0;
}
