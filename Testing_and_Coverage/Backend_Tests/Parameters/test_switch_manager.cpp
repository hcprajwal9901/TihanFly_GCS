#include <gtest/gtest.h>
#include "Parameters/switch_manager.h"
#include "Vehicle/vehicle_manager.h"
#include "Vehicle/vehicle.h"
#include "Link/link_manager.h"
#include "Transport/transport.h"

class SwitchMockTransport : public Transport {
public:
    std::vector<std::vector<uint8_t>> sent_data;
    
    void start() override {}
    void async_send(const uint8_t* data, size_t length) override {
        sent_data.push_back(std::vector<uint8_t>(data, data + length));
    }
    void set_receive_callback(std::function<void(const uint8_t*, size_t)> cb) override {}
    void stop() {} // Adding if required by interface, but shouldn't be virtual
};

class SwitchManagerTest : public ::testing::Test {
protected:
    std::unique_ptr<LinkManager> lm;
    std::unique_ptr<VehicleManager> vm;
    std::unique_ptr<SwitchManager> sm;
    std::shared_ptr<SwitchMockTransport> mock_transport;
    asio::io_context io;

    void SetUp() override {
        lm = std::make_unique<LinkManager>();
        mock_transport = std::make_shared<SwitchMockTransport>();
        int link_id = lm->add_link(mock_transport, io);
        
        vm = std::make_unique<VehicleManager>(lm.get());
        sm = std::make_unique<SwitchManager>(vm.get());
        
        // Feed a heartbeat to create a vehicle
        mavlink_message_t hb_msg;
        mavlink_heartbeat_t hb = {};
        mavlink_msg_heartbeat_encode(1, 1, &hb_msg, &hb);
        vm->handle_message(hb_msg, link_id);
    }
    
    std::vector<mavlink_message_t> get_sent_messages() {
        std::vector<mavlink_message_t> msgs;
        for (const auto& data : mock_transport->sent_data) {
            mavlink_message_t msg;
            mavlink_status_t status;
            for (uint8_t byte : data) {
                if (mavlink_parse_char(MAVLINK_COMM_0, byte, &msg, &status)) {
                    msgs.push_back(msg);
                }
            }
        }
        return msgs;
    }
};

// UT-SM-001
TEST_F(SwitchManagerTest, SetSwitchOption) {
    sm->set_switch_option(7, 41);
    
    auto sent_messages = get_sent_messages();
    ASSERT_EQ(sent_messages.size(), 1);
    mavlink_param_set_t ps;
    mavlink_msg_param_set_decode(&sent_messages[0], &ps);
    
    std::string param_id(ps.param_id, strnlen(ps.param_id, 16));
    EXPECT_EQ(param_id, "RC7_OPTION");
    EXPECT_EQ(ps.param_value, 41.0f);
    
    EXPECT_EQ(sm->pending_count(), 1);
}

// UT-SM-002
TEST_F(SwitchManagerTest, WriteAllPending) {
    sm->set_switch_option(7, 41);
    sm->set_switch_option(8, 42);
    mock_transport->sent_data.clear();
    
    int count = sm->write_all_pending();
    EXPECT_EQ(count, 2);
    
    auto sent_messages = get_sent_messages();
    EXPECT_EQ(sent_messages.size(), 2);
    
    EXPECT_EQ(sm->pending_count(), 2);
}

// UT-SM-003
TEST_F(SwitchManagerTest, ClearPending) {
    sm->set_switch_option(7, 41);
    EXPECT_EQ(sm->pending_count(), 1);
    sm->clear_pending();
    EXPECT_EQ(sm->pending_count(), 0);
}

// UT-SM-004
TEST_F(SwitchManagerTest, RequestParamRead) {
    sm->request_param_read(7);
    
    auto sent_messages = get_sent_messages();
    ASSERT_EQ(sent_messages.size(), 1);
    mavlink_param_request_read_t req;
    mavlink_msg_param_request_read_decode(&sent_messages[0], &req);
    
    std::string param_id(req.param_id, strnlen(req.param_id, 16));
    EXPECT_EQ(param_id, "RC7_OPTION");
    EXPECT_EQ(req.param_index, -1);
}

// UT-SM-005
TEST_F(SwitchManagerTest, WriteCallback) {
    int callback_count = 0;
    sm->set_on_write([&](int ch, const std::string& name, int val) {
        callback_count++;
        EXPECT_EQ(ch, 7);
        EXPECT_EQ(name, "RC7_OPTION");
        EXPECT_EQ(val, 41);
    });
    
    sm->set_switch_option(7, 41);
    EXPECT_EQ(callback_count, 1);
}
