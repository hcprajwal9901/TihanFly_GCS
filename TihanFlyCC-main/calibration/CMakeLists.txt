add_library(Vehicle STATIC
    vehicle.cpp
    vehicle_manager.cpp
    ../calibration/accel_calibration.cpp
)

target_include_directories(Vehicle
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}          # vehicle.h, vehicle_manager.h 
        ${PROJECT_SOURCE_DIR}/include
        ${PROJECT_SOURCE_DIR}/mavlink
        ${PROJECT_SOURCE_DIR}/calibration
)

target_link_libraries(Vehicle
    PUBLIC
        Parser
        Transport
)
