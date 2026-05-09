add_library(Vehicle STATIC
    vehicle.cpp
    vehicle_manager.cpp
    ${PROJECT_SOURCE_DIR}/calibration/accel_calibration.cpp
    ${PROJECT_SOURCE_DIR}/calibration/compass_calibration.cpp
    ${PROJECT_SOURCE_DIR}/calibration/esc_calibration.cpp
    ${PROJECT_SOURCE_DIR}/calibration/radio_calibration.cpp
)

target_include_directories(Vehicle
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}              # vehicle.h, vehicle_manager.h
        ${PROJECT_SOURCE_DIR}/include
        ${PROJECT_SOURCE_DIR}/mavlink
        ${PROJECT_SOURCE_DIR}/calibration        # accel_calibration.h, compass_calibration.h, esc_calibration.h, radio_calibration.h
        ${PROJECT_SOURCE_DIR}                    # for #include "calibration/accel_calibration.h"
                                                 # and #include "calibration/compass_calibration.h"
                                                 # and #include "calibration/esc_calibration.h"
                                                 # and #include "calibration/radio_calibration.h"
)

target_link_libraries(Vehicle
    PUBLIC
        Parser
        Transport
)