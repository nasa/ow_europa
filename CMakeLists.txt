cmake_minimum_required(VERSION 3.0.2)
project(ow_europa)

find_package(catkin REQUIRED)

catkin_package()

catkin_add_env_hooks(
  70.ow_europa
  SHELLS sh DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/env-hooks
)

