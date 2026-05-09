cmake_minimum_required(VERSION 3.16)
project(TiHANFlyBackend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_BUILD_TYPE Release CACHE STRING "")

add_compile_options(-Wall -Wextra -O2)

find_package(Boost 1.74 REQUIRED COMPONENTS system)
find_package(OpenSSL REQUIRED)

# ── MySQL client ──────────────────────────────────────────────
find_program(MYSQL_CONFIG mysql_config REQUIRED)

execute_process(
    COMMAND ${MYSQL_CONFIG} --include
    OUTPUT_VARIABLE MYSQL_INCLUDE_FLAGS
    OUTPUT_STRIP_TRAILING_WHITESPACE)

# Strip -I prefix to get raw include path
string(REPLACE "-I" "" MYSQL_INCLUDE_DIR "${MYSQL_INCLUDE_FLAGS}")
string(STRIP "${MYSQL_INCLUDE_DIR}" MYSQL_INCLUDE_DIR)

# Find the actual mysqlclient library file
find_library(MYSQLCLIENT_LIB
    NAMES mysqlclient mysqlclient_r
    PATHS /usr/lib /usr/lib/x86_64-linux-gnu /usr/lib/mysql
          /usr/lib/aarch64-linux-gnu
    REQUIRED)

message(STATUS "MySQL include: ${MYSQL_INCLUDE_DIR}")
message(STATUS "MySQL library: ${MYSQLCLIENT_LIB}")

# ── nlohmann/json ─────────────────────────────────────────────
find_package(nlohmann_json QUIET)
if(NOT nlohmann_json_FOUND)
    include(FetchContent)
    FetchContent_Declare(nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
    FetchContent_MakeAvailable(nlohmann_json)
endif()

add_executable(tihanfly_server main.cpp)

target_include_directories(tihanfly_server PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${Boost_INCLUDE_DIRS}
    ${MYSQL_INCLUDE_DIR}
)

target_link_libraries(tihanfly_server PRIVATE
    Boost::system
    OpenSSL::SSL
    OpenSSL::Crypto
    nlohmann_json::nlohmann_json
    ${MYSQLCLIENT_LIB}
    pthread
)