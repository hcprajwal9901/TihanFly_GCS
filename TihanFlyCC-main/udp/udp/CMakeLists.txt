add_library(udp udp.cpp)
target_include_directories(udp INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(udp PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../include)
target_link_libraries(udp PRIVATE Threads::Threads)
