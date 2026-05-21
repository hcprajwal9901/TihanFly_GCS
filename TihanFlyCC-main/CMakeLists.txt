cmake_minimum_required(VERSION 3.16)
project(TiHANFly CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

enable_testing()

# ── Coverage Configuration ───────────────────────────────────────────────────
option(ENABLE_COVERAGE "Enable Code Coverage testing" OFF)
if(ENABLE_COVERAGE)
    add_compile_options(--coverage)
    add_link_options(--coverage)
endif()

# ── Build type default ────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# ── Compiler flags ────────────────────────────────────────────────────────────
if(MSVC)
    add_compile_options(/W3 /wd4100 /wd4996)   # MSVC: warning level 3, suppress unused-param & deprecated
else()
    add_compile_options(-Wall -Wextra -Wno-unused-parameter)
endif()

# ── Find packages ─────────────────────────────────────────────────────────────
find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(ZLIB REQUIRED)

# nlohmann/json — header-only; adjust path if you vendor it differently
include(FetchContent)
FetchContent_Declare(json
    URL https://github.com/nlohmann/json/releases/download/v3.11.2/json.tar.xz
)
FetchContent_MakeAvailable(json)

# MAVLink — header-only; set MAVLINK_INCLUDE_DIR if not on the default path
if(NOT DEFINED MAVLINK_INCLUDE_DIR)
    set(MAVLINK_INCLUDE_DIR "/usr/local/include/mavlink/v2.0"
        CACHE PATH "MAVLink v2 headers root")
endif()

# ASIO — standalone (no Boost); set ASIO_INCLUDE_DIR if not on the default path
if(NOT DEFINED ASIO_INCLUDE_DIR)
    set(ASIO_INCLUDE_DIR "/usr/local/include"
        CACHE PATH "Standalone ASIO include directory")
endif()

# OpenCV removed — camera module is no longer used

# ── Include directories ───────────────────────────────────────────────────────
include_directories(
    ${PROJECT_SOURCE_DIR}
    ${PROJECT_SOURCE_DIR}/include
    ${MAVLINK_INCLUDE_DIR}
    ${ASIO_INCLUDE_DIR}
    ${OPENSSL_INCLUDE_DIR}
    ${ZLIB_INCLUDE_DIRS}
)

# ── Source files ──────────────────────────────────────────────────────────────
set(SOURCES_CORE

    # ── Transport layer ───────────────────────────────────────────────────
    Transport/udp.cpp
    Transport/serial.cpp

    # ── Link layer ────────────────────────────────────────────────────────
    Link/link.cpp
    Link/link_manager.cpp

    # ── Command manager ───────────────────────────────────────────────────
    Command/command_manager.cpp

    # ── Vehicle ───────────────────────────────────────────────────────────
    Vehicle/vehicle.cpp
    Vehicle/vehicle_manager.cpp  # <-- ADDED: required by CommandManager refactor

    # ── Parameter manager ─────────────────────────────────────────────────
    Parameters/parameter_manager.cpp
    Parameters/switch_manager.cpp

    # ── Calibration sub-modules ───────────────────────────────────────────
    calibration/accel_calibration.cpp
    calibration/compass_calibration.cpp
    calibration/esc_calibration.cpp
    calibration/radio_calibration.cpp

    # ── Flight mode sub-module ────────────────────────────────────────────
    Flightmode/flight_mode.cpp

    # ── Firmware ──────────────────────────────────────────────────────────
    Firmware/firmware_manager.cpp
    Firmware/firmware_uploader.cpp

    # Camera removed — video is handled via RTSP relay in the Electron layer


    # ── MAVLink Inspector ─────────────────────────────────────────────────
    Inspector/mavlink_inspector.cpp
    
    # ── Parser ────────────────────────────────────────────────────────────
    Parser/mavlink_parser.cpp
)

# ── Static Library for Core Logic (used by app and tests) ─────────────────────
add_library(TiHANFlyCore STATIC ${SOURCES_CORE})

target_compile_definitions(TiHANFlyCore PRIVATE
    ASIO_STANDALONE          # use standalone ASIO, not Boost.ASIO
    _WEBSOCKETPP_CPP11_STL_  # if websocketpp headers are present
)

target_link_libraries(TiHANFlyCore
    PUBLIC
    Threads::Threads
    OpenSSL::SSL
    OpenSSL::Crypto
    ZLIB::ZLIB
)

target_link_libraries(TiHANFlyCore PUBLIC nlohmann_json::nlohmann_json)

if(WIN32)
    target_link_libraries(TiHANFlyCore PUBLIC ws2_32 mswsock)
endif()

# ── Executable ────────────────────────────────────────────────────────────────
add_executable(TiHANFly main.cpp)

# ── Preprocessor definitions ─────────────────────────────────────────────────
target_compile_definitions(TiHANFly PRIVATE
    ASIO_STANDALONE          # use standalone ASIO, not Boost.ASIO
    _WEBSOCKETPP_CPP11_STL_  # if websocketpp headers are present
)

# ── Link libraries ────────────────────────────────────────────────────────────
target_link_libraries(TiHANFly PRIVATE TiHANFlyCore)


# ── Optional: copy binary to project root after build ─────────────────────────
# add_custom_command(TARGET TiHANFly POST_BUILD
#     COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:TiHANFly> ${PROJECT_SOURCE_DIR}/TiHANFly
# )

# ── Install rule (optional) ───────────────────────────────────────────────────
install(TARGETS TiHANFly DESTINATION bin)

# ── Testing Subdirectory ──────────────────────────────────────────────────────
add_subdirectory(../Testing_and_Coverage/Backend_Tests ${CMAKE_CURRENT_BINARY_DIR}/Backend_Tests_build)
