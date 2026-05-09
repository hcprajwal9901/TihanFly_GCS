add_library(Command
    command_manager.cpp
)

target_include_directories(Command PUBLIC ${CMAKE_SOURCE_DIR})