find_package(GTest REQUIRED)

add_executable(test_transport
    test_udp.cpp
    test_serial.cpp
)

target_link_libraries(test_transport
    PRIVATE
        Transport
        GTest::GTest
        GTest::Main
        Threads::Threads
)

add_test(NAME TransportTests COMMAND test_transport)
