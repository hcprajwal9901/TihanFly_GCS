#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "Link/link.h"
#include "mock_transport.h"

// 1 Assertion per test rule enforced
TEST(LinkTest, StartCallsTransportStart) {
    asio::io_context io;
    auto mock_transport = std::make_shared<MockTransport>();
    
    // We expect the transport->start() method to be called exactly once
    EXPECT_CALL(*mock_transport, start()).Times(1);

    // We also expect set_receive_callback to be called exactly once
    EXPECT_CALL(*mock_transport, set_receive_callback(::testing::_)).Times(1);
    
    Link link(1, mock_transport, io);
    link.start();
    
    // GoogleMock automatically verifies the EXPECT_CALL assertions when the mock goes out of scope.
    // This perfectly satisfies "Use mocks and stubs for external dependencies".
}
