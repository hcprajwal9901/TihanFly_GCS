cmake_minimum_required(VERSION 3.16)

add_library(Inspector
    mavlink_inspector.cpp
)

target_include_directories(Inspector PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_SOURCE_DIR}/mavlink
)

find_package(Threads REQUIRED)
target_link_libraries(Inspector PUBLIC Threads::Threads)
