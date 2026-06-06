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
find_package(nlohmann_json 3.2.0 QUIET)
if(NOT nlohmann_json_FOUND)
    # Fallback: assume it is installed system-wide or in a subdirectory
    include_directories(/usr/include/nlohmann)
endif()

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
set(SOURCES
    main.cpp

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

# ── Executable ────────────────────────────────────────────────────────────────
add_executable(TiHANFly ${SOURCES})

# ── Preprocessor definitions ─────────────────────────────────────────────────
target_compile_definitions(TiHANFly PRIVATE
    ASIO_STANDALONE          # use standalone ASIO, not Boost.ASIO
    _WEBSOCKETPP_CPP11_STL_  # if websocketpp headers are present
)

# ── Link libraries ────────────────────────────────────────────────────────────
target_link_libraries(TiHANFly
    Threads::Threads
    OpenSSL::SSL
    OpenSSL::Crypto
    ZLIB::ZLIB          # zlib — required by firmware_manager.cpp for APJ decompression
)

# Link nlohmann_json if found as a CMake target, otherwise it's header-only
if(nlohmann_json_FOUND)
    target_link_libraries(TiHANFly nlohmann_json::nlohmann_json)
endif()

# ── std::filesystem linker fix (GCC 8 / Ubuntu 18.04) ────────────────────────
# GCC 9+ and Clang 7+: std::filesystem is in libstdc++/libc++ — no extra flag.
# GCC 8 (Ubuntu 18.04): std::filesystem is in a separate -lstdc++fs library.
# This block auto-detects which case applies, so the same CMakeLists.txt
# compiles correctly on:
#   • Windows  (MSVC)            — no flag needed
#   • Ubuntu 20.04+ x86_64       — GCC 9+, no flag needed
#   • Ubuntu 18.04 x86_64        — GCC 8, needs -lstdc++fs
#   • Ubuntu 20.04+ ARM64        — GCC 9+, no flag needed  (Raspberry Pi 4/5,
#                                    Jetson, etc.)
#   • Any Clang 7+               — no flag needed
if(NOT MSVC)
    include(CheckCXXSourceCompiles)
    set(CMAKE_REQUIRED_FLAGS "-std=c++17")
    check_cxx_source_compiles("
        #include <filesystem>
        int main() { std::filesystem::path p; return 0; }
    " HAS_STD_FILESYSTEM)

    if(NOT HAS_STD_FILESYSTEM)
        # Try with -lstdc++fs (GCC 8)
        set(CMAKE_REQUIRED_LIBRARIES "stdc++fs")
        check_cxx_source_compiles("
            #include <filesystem>
            int main() { std::filesystem::path p; return 0; }
        " HAS_STD_FILESYSTEM_WITH_LIB)
        unset(CMAKE_REQUIRED_LIBRARIES)

        if(HAS_STD_FILESYSTEM_WITH_LIB)
            target_link_libraries(TiHANFly stdc++fs)
            message(STATUS "Linking -lstdc++fs for std::filesystem (GCC 8)")
        else()
            message(WARNING "std::filesystem not found — build may fail")
        endif()
    else()
        message(STATUS "std::filesystem built-in (GCC 9+ / Clang 7+)")
    endif()
endif()


# ── Optional: copy binary to project root after build ─────────────────────────
# add_custom_command(TARGET TiHANFly POST_BUILD
#     COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:TiHANFly> ${PROJECT_SOURCE_DIR}/TiHANFly
# )

# ── Install rule (optional) ───────────────────────────────────────────────────
install(TARGETS TiHANFly DESTINATION bin)

# ── Testing Subdirectory ──────────────────────────────────────────────────────
add_subdirectory(../test_backend ${CMAKE_CURRENT_BINARY_DIR}/test_backend_build)
