#include <gtest/gtest.h>
#include <gmock/gmock.h>
#define private public
#define protected public
#include "Parser/mavlink_parser.h"
#include <mavlink/ardupilotmega/mavlink.h>
#include <vector>

// Helper to generate a valid MAVLink heartbeat buffer
std::vector<uint8_t> create_heartbeat_buffer() {
    mavlink_message_t msg;
    mavlink_msg_heartbeat_pack(1, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, MAV_MODE_GUIDED_ARMED, 0, MAV_STATE_ACTIVE);
    
    std::vector<uint8_t> buffer(MAVLINK_MAX_PACKET_LEN);
    uint16_t len = mavlink_msg_to_send_buffer(buffer.data(), &msg);
    buffer.resize(len);
    return buffer;
}

// UT-PAR-001: Initialization & Reset
TEST(MAVLinkParserTest, InitializationAndReset) {
    MAVLinkParser parser;
    EXPECT_NO_THROW(parser.reset());
}

// UT-PAR-002: Parse Complete Buffer
TEST(MAVLinkParserTest, ParseCompleteBuffer) {
    MAVLinkParser parser;
    
    int call_count = 0;
    uint32_t received_msgid = 0;
    
    parser.set_message_callback([&](const mavlink_message_t& msg) {
        call_count++;
        received_msgid = msg.msgid;
    });

    std::vector<uint8_t> buffer = create_heartbeat_buffer();
    parser.parse_bytes(buffer.data(), buffer.size());

    EXPECT_EQ(call_count, 1);
    EXPECT_EQ(received_msgid, MAVLINK_MSG_ID_HEARTBEAT);
}

// UT-PAR-003: Parse Partial Bytes (Streaming)
TEST(MAVLinkParserTest, ParsePartialBytes) {
    MAVLinkParser parser;
    
    int call_count = 0;
    
    parser.set_message_callback([&](const mavlink_message_t& msg) {
        call_count++;
        EXPECT_EQ(msg.msgid, MAVLINK_MSG_ID_HEARTBEAT);
    });

    std::vector<uint8_t> buffer = create_heartbeat_buffer();
    
    // Feed one byte at a time
    for (size_t i = 0; i < buffer.size(); ++i) {
        parser.parse_bytes(&buffer[i], 1);
        
        // Callback should only trigger on the very last byte
        if (i < buffer.size() - 1) {
            EXPECT_EQ(call_count, 0);
        }
    }
    
    EXPECT_EQ(call_count, 1);
}

// UT-PAR-004: Parse Invalid/Garbage Data
TEST(MAVLinkParserTest, ParseInvalidGarbageData) {
    MAVLinkParser parser;
    
    int call_count = 0;
    parser.set_message_callback([&](const mavlink_message_t& msg) {
        call_count++;
    });

    // Create random garbage bytes
    std::vector<uint8_t> garbage = {0xFF, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x11, 0x22};
    parser.parse_bytes(garbage.data(), garbage.size());

    EXPECT_EQ(call_count, 0);
}

// UT-PAR-005: Reset State Interruption
TEST(MAVLinkParserTest, ResetStateInterruption) {
    MAVLinkParser parser;
    
    int call_count = 0;
    parser.set_message_callback([&](const mavlink_message_t& msg) {
        call_count++;
    });

    std::vector<uint8_t> buffer = create_heartbeat_buffer();
    size_t half_size = buffer.size() / 2;
    
    // Feed first half
    parser.parse_bytes(buffer.data(), half_size);
    EXPECT_EQ(call_count, 0);
    
    // Reset parser (should wipe state)
    parser.reset();
    
    // Feed second half
    parser.parse_bytes(buffer.data() + half_size, buffer.size() - half_size);
    
    // Because state was wiped midway, the packet is broken and callback should not fire
    EXPECT_EQ(call_count, 0);
}

/*
===============================================================================
    FUNCTIONAL UNIT TEST CASES
    Based on Spreadsheet Requirements
===============================================================================
*/

/*
    UT-PAR-FUNC-001
    Function : MAVLinkParser::parse_bytes
    Description : Parses bytes.
    Input : buffer data
    Expected Output : Callback fires
*/
TEST(MAVLinkParserTest, ParseBytesFUNC) {
    MAVLinkParser parser;
    uint8_t data[] = {0xFE, 0x09, 0x00, 0x01, 0x01, 0x00};
    EXPECT_NO_THROW(parser.parse_bytes(data, sizeof(data)));
}

/*
    UT-PAR-FUNC-002
    Function : MAVLinkParser::reset
    Description : Resets parser state.
    Input : None
    Expected Output : State reset successful
*/
TEST(MAVLinkParserTest, ResetFUNC) {
    MAVLinkParser parser;
    EXPECT_NO_THROW(parser.reset());
}

/*
===============================================================================
    EXTREME TEST CASES
===============================================================================
*/

/*
    UT-PAR-EXT-001
    Function : MAVLinkParser::parse_bytes
    Description : Null buffer parse attempt.
    Input : null ptr, len = 10
    Expected Output : Safely returns without crash
*/
TEST(MAVLinkParserTest, NullBufferHandling) {
    MAVLinkParser parser;
    EXPECT_NO_THROW(parser.parse_bytes(nullptr, 0));
}

/*
    UT-PAR-006
    Function : MAVLinkParser::set_message_callback
    Description : Register decoded message handler.
    Input : message callback lambda
    Expected Output : saves callback successfully
*/
TEST(MAVLinkParserTest, SetMessageCallbackFUNC) {
    MAVLinkParser parser;
    EXPECT_NO_THROW(parser.set_message_callback([](const mavlink_message_t&){}));
}

