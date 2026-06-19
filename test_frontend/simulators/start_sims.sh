#!/bin/bash
source ~/venv-ardupilot/bin/activate
# Start proxy
python3 "/mnt/e/TiHAN/TflyGCS (1)/TflyGCS/test_frontend/simulators/mavlink_proxy.py" --sitl-ports 14590,14591,14592 --gcs-port 14550 --http-port 14599 &
sleep 2

# Start Vehicle 1
cd ~/ardupilot/ArduCopter && ( : ; /home/hcprajwal/ardupilot/build/sitl/bin/arducopter --model + --speedup 1 --slave 0 --defaults ../Tools/autotest/default_params/copter.parm,'/mnt/e/TiHAN/TflyGCS (1)/TflyGCS/test_frontend/simulators/sysid1.param' --sim-address=127.0.0.1 -I0 ) &
# Start MAVProxy 1
/home/hcprajwal/venv-ardupilot/bin/mavproxy.py --retries 5 --streamrate=10 --master tcp:127.0.0.1:5760 --sitl 127.0.0.1:5501 --out 127.0.0.1:14590 &

# Start Vehicle 2
cd ~/ardupilot/ArduCopter && ( : ; /home/hcprajwal/ardupilot/build/sitl/bin/arducopter --model + --speedup 1 --slave 0 --defaults ../Tools/autotest/default_params/copter.parm,'/mnt/e/TiHAN/TflyGCS (1)/TflyGCS/test_frontend/simulators/sysid2.param' --sim-address=127.0.0.1 -I1 ) &
# Start MAVProxy 2
/home/hcprajwal/venv-ardupilot/bin/mavproxy.py --retries 5 --streamrate=10 --master tcp:127.0.0.1:5770 --sitl 127.0.0.1:5511 --out 127.0.0.1:14591 &

# Start Vehicle 3
cd ~/ardupilot/ArduCopter && ( : ; /home/hcprajwal/ardupilot/build/sitl/bin/arducopter --model + --speedup 1 --slave 0 --defaults ../Tools/autotest/default_params/copter.parm,'/mnt/e/TiHAN/TflyGCS (1)/TflyGCS/test_frontend/simulators/sysid3.param' --sim-address=127.0.0.1 -I2 ) &
# Start MAVProxy 3
/home/hcprajwal/venv-ardupilot/bin/mavproxy.py --retries 5 --streamrate=10 --master tcp:127.0.0.1:5780 --sitl 127.0.0.1:5521 --out 127.0.0.1:14592 &

wait
