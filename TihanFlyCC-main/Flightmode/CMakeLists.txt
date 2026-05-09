add_library(Flightmode STATIC
    flight_mode.cpp
)

target_include_directories(Flightmode
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}         # flight_mode.h
        ${PROJECT_SOURCE_DIR}               # project-wide headers
        ${PROJECT_SOURCE_DIR}/mavlink       # mavlink/ardupilotmega/mavlink.h
        ${ASIO_INCLUDE_DIR}                 # asio.hpp (needed transitively)
)

target_compile_definitions(Flightmode
    PUBLIC
        ASIO_STANDALONE
)

target_link_libraries(Flightmode
    PUBLIC
        nlohmann_json::nlohmann_json        # or header-only fallback below
)

# nlohmann_json fallback if not found as a CMake target
if(NOT nlohmann_json_FOUND)
    target_include_directories(Flightmode PUBLIC /usr/include/nlohmann)

    endif()