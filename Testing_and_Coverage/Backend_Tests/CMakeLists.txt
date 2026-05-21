include(FetchContent)

FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/03597a01ee50ed33e9dfd640b249b4be3799d395.zip
)
# For Windows: Prevent overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# Define the unit test executable
add_executable(tihanfly_tests
    test_udp.cpp
    test_serial.cpp
    test_link.cpp
    test_link_manager.cpp
    test_mavlink_inspector.cpp
    test_mavlink_parser.cpp
    test_vehicle.cpp
)

# Link against the core library and GTest
target_link_libraries(tihanfly_tests
    PRIVATE
    TiHANFlyCore
    GTest::gtest_main
    GTest::gmock
)

# Register tests with CTest
include(GoogleTest)
gtest_discover_tests(tihanfly_tests)
