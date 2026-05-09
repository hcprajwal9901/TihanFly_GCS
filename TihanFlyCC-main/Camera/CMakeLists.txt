add_library(Camera STATIC
    camera_capture.cpp
    mjpeg_server.cpp
)

# ✅ Find OpenCV (required for capture + JPEG encoding)
find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs videoio)

target_include_directories(Camera
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}     # camera_capture.h, mjpeg_server.h
        ${PROJECT_SOURCE_DIR}/include   # asio.hpp
        ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(Camera
    PUBLIC
        ${OpenCV_LIBS}
        Threads::Threads
)
