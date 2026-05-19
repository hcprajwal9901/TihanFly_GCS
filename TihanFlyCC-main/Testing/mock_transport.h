#pragma once

#include <gmock/gmock.h>
#include "Transport/transport.h"

// Mock class for Transport interface to test business logic independently of hardware
class MockTransport : public Transport {
public:
    MOCK_METHOD(void, start, (), (override));
    MOCK_METHOD(void, async_send, (const uint8_t* data, std::size_t length), (override));
    MOCK_METHOD(void, set_receive_callback, (ReceiveCallback cb), (override));
};
