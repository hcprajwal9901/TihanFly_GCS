include(FetchContent)

FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/03597a01ee50ed33e9dfd640b249b4be3799d395.zip
)
# For Windows: Prevent overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(ZLIB REQUIRED)
find_package(nlohmann_json 3.2.0 QUIET)
if(NOT nlohmann_json_FOUND)
    include_directories(/usr/include/nlohmann)
endif()

find_package(OpenCV REQUIRED)

# Since TiHANFlyCore was removed from the main CMakeLists.txt, we compile the sources directly here.
set(BACKEND_SOURCES
    ../../TihanFlyCC-main/Transport/udp.cpp
    ../../TihanFlyCC-main/Transport/serial.cpp
    ../../TihanFlyCC-main/Link/link.cpp
    ../../TihanFlyCC-main/Link/link_manager.cpp
    ../../TihanFlyCC-main/Command/command_manager.cpp
    ../../TihanFlyCC-main/Vehicle/vehicle.cpp
    ../../TihanFlyCC-main/Vehicle/vehicle_manager.cpp
    ../../TihanFlyCC-main/Parameters/parameter_manager.cpp
    ../../TihanFlyCC-main/Parameters/switch_manager.cpp
    ../../TihanFlyCC-main/calibration/accel_calibration.cpp
    ../../TihanFlyCC-main/calibration/compass_calibration.cpp
    ../../TihanFlyCC-main/calibration/esc_calibration.cpp
    ../../TihanFlyCC-main/calibration/radio_calibration.cpp
    ../../TihanFlyCC-main/Flightmode/flight_mode.cpp
    ../../TihanFlyCC-main/Firmware/firmware_manager.cpp
    ../../TihanFlyCC-main/Firmware/firmware_uploader.cpp
    ../../TihanFlyCC-main/Inspector/mavlink_inspector.cpp
    ../../TihanFlyCC-main/Parser/mavlink_parser.cpp
    ../../TihanFlyCC-main/udp/udp/udp.cpp
    ../../TihanFlyCC-main/udp/serial/serial.cpp
    ../../TihanFlyCC-main/Camera/camera_capture.cpp
    ../../TihanFlyCC-main/Camera/mjpeg_server.cpp
)

# Define the unit test executable
add_executable(tihanfly_tests
    ${BACKEND_SOURCES}
    Transport/test_udp.cpp
    Transport/test_serial.cpp
    Link/test_link.cpp
    Link/test_link_manager.cpp
    Inspector/test_mavlink_inspector.cpp
    Parser/test_mavlink_parser.cpp
    Vehicle/test_vehicle.cpp
    udp/test_udp.cpp
    udp/test_serial.cpp
    calibration/test_accel_calibration.cpp
    calibration/test_compass_calibration.cpp
    calibration/test_esc_calibration.cpp
    calibration/test_radio_calibration.cpp
    camera/test_camera_capture.cpp
    camera/test_mjpeg_server.cpp
    Command/test_command_manager.cpp
    Firmware/test_firmware.cpp
    Flightmode/test_flight_mode.cpp
    Parameters/test_parameter_manager.cpp
    Parameters/test_switch_manager.cpp
)

target_compile_definitions(tihanfly_tests PRIVATE
    ASIO_STANDALONE
)

target_include_directories(tihanfly_tests PRIVATE
    ../../TihanFlyCC-main
    ../../TihanFlyCC-main/include
    /usr/local/include/mavlink/v2.0
    /usr/local/include
)

# Link against GTest and necessary libraries
target_link_libraries(tihanfly_tests
    PRIVATE
    GTest::gtest_main
    GTest::gmock
    Threads::Threads
    OpenSSL::SSL
    OpenSSL::Crypto
    ZLIB::ZLIB
    ${OpenCV_LIBS}
)

if(nlohmann_json_FOUND)
    target_link_libraries(tihanfly_tests PRIVATE nlohmann_json::nlohmann_json)
endif()

# Register tests with CTest
include(GoogleTest)
gtest_discover_tests(tihanfly_tests)
