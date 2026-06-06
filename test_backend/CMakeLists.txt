cmake_minimum_required(VERSION 3.16)
project(tihanfly_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Enable testing
enable_testing()

# ── Google Test (FetchContent) ────────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/03597a01ee50ed33e9dfd640b249b4be3799d395.zip
)
# For Windows: Prevent overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# ── Dependencies ──────────────────────────────────────────────────────────────
find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(ZLIB REQUIRED)
find_package(nlohmann_json 3.2.0 QUIET)

# ── Sources ───────────────────────────────────────────────────────────────────
set(BACKEND_SOURCES
    ../TihanFlyCC-main/Parser/mavlink_parser.cpp
    ../TihanFlyCC-main/Inspector/mavlink_inspector.cpp
    ../TihanFlyCC-main/Transport/udp.cpp
    ../TihanFlyCC-main/Transport/serial.cpp
    ../TihanFlyCC-main/Link/link.cpp
    ../TihanFlyCC-main/Link/link_manager.cpp
    ../TihanFlyCC-main/Command/command_manager.cpp
    ../TihanFlyCC-main/Vehicle/vehicle.cpp
    ../TihanFlyCC-main/Vehicle/vehicle_manager.cpp
    ../TihanFlyCC-main/Parameters/parameter_manager.cpp
    ../TihanFlyCC-main/Parameters/switch_manager.cpp
    ../TihanFlyCC-main/Flightmode/flight_mode.cpp
    ../TihanFlyCC-main/Firmware/firmware_manager.cpp
    ../TihanFlyCC-main/Firmware/firmware_uploader.cpp
    ../TihanFlyCC-main/calibration/accel_calibration.cpp
    ../TihanFlyCC-main/calibration/compass_calibration.cpp
    ../TihanFlyCC-main/calibration/esc_calibration.cpp
    ../TihanFlyCC-main/calibration/radio_calibration.cpp
)

set(TEST_SOURCES
    Parser/test_mavlink_parser.cpp
    Inspector/test_mavlink_inspector.cpp
    Transport/test_udp.cpp
    Transport/test_serial.cpp
    Link/test_link.cpp
    Link/test_link_manager.cpp
    Command/test_command_manager.cpp
    Vehicle/test_vehicle.cpp
    Vehicle/test_vehicle_manager.cpp
    Parameters/test_parameter_manager.cpp
    Parameters/test_switch_manager.cpp
    Flightmode/test_flight_mode.cpp
    Firmware/test_firmware_manager.cpp
    Firmware/test_firmware_uploader.cpp
    calibration/test_accel_calibration.cpp
    calibration/test_compass_calibration.cpp
    calibration/test_esc_calibration.cpp
    calibration/test_radio_calibration.cpp
)

# ── Target ────────────────────────────────────────────────────────────────────
add_executable(tihanfly_tests
    ${BACKEND_SOURCES}
    ${TEST_SOURCES}
)

target_compile_definitions(tihanfly_tests PRIVATE
    ASIO_STANDALONE
)

# Include paths:
# 1. ../TihanFlyCC-main allows including files like "Parser/mavlink_parser.h" and also finds the local "mavlink" directory
# 2. ../TihanFlyCC-main/include contains standalone ASIO (asio.hpp and asio/)
target_include_directories(tihanfly_tests PRIVATE
    ../TihanFlyCC-main
    ../TihanFlyCC-main/include
    ${OPENSSL_INCLUDE_DIR}
    ${ZLIB_INCLUDE_DIRS}
)

# Link against GTest and libraries
target_link_libraries(tihanfly_tests
    PRIVATE
    gtest_main
    gmock
    Threads::Threads
    OpenSSL::SSL
    OpenSSL::Crypto
    ZLIB::ZLIB
)

if(UNIX AND NOT APPLE)
    target_link_libraries(tihanfly_tests PRIVATE util)
endif()

if(nlohmann_json_FOUND)
    target_link_libraries(tihanfly_tests PRIVATE nlohmann_json::nlohmann_json)
endif()

# Register tests
include(GoogleTest)
gtest_discover_tests(tihanfly_tests)
