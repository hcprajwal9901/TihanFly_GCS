# Create Transport static library
add_library(Transport STATIC
    udp.cpp
    serial.cpp
)

# Public include directories (visible to anything linking Transport)
target_include_directories(Transport
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}           # udp.h, serial.h
        ${PROJECT_SOURCE_DIR}/include        # ASIO headers
)

# Required for standalone ASIO
target_compile_definitions(Transport
    PUBLIC
        ASIO_STANDALONE
)

# Threads (required by ASIO)
find_package(Threads REQUIRED)

target_link_libraries(Transport
    PUBLIC
        Threads::Threads
)

# Compiler warnings (recommended for transport layer)
if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(Transport PRIVATE
        -Wall -Wextra -Wpedantic
    )
endif()
