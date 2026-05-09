add_library(
    Parser STATIC
    mavlink_parser.cpp
)

target_include_directories(
    Parser
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}           # mavlink_parser.h
        ${PROJECT_SOURCE_DIR}       # MAVLink headers
)