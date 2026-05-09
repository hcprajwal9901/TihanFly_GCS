cmake_minimum_required(VERSION 3.16)
project(UDP)

add_executable(UDP main.cpp)

find_package(Threads)

target_include_directories(UDP PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_link_libraries(UDP PRIVATE Threads::Threads udp)

add_subdirectory(udp)