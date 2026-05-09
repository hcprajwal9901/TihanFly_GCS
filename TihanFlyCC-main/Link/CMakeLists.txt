add_library(Link STATIC
    link.cpp
    link_manager.cpp
)

target_include_directories(Link
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${PROJECT_SOURCE_DIR}/include
)

target_link_libraries(Link
    PUBLIC
        Parser
        Transport
)
