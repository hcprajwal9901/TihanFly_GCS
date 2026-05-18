/**
 * param-full.js  —  TiHANFly GCS  —  Full Parameter List (with metadata)
 * Columns: Parameter | Value | Units | Range/Options | Description
 */
(function () {
    'use strict';

    // ─── ArduCopter parameter metadata ────────────────────────────────────────
    // { NAME: { d: description, u: units, r: range/options string } }
    const META = {
        ACRO_BAL_PITCH:   { d:'Rate at which pitch returns to level in acro mode', u:'deg/s', r:'0 - 3' },
        ACRO_BAL_ROLL:    { d:'Rate at which roll returns to level in acro mode',  u:'deg/s', r:'0 - 3' },
        ACRO_OPTIONS:     { d:'Acro mode options bitmask', u:'', r:'' },
        ACRO_RP_EXPO:     { d:'Roll/pitch expo for more precise low-speed control', u:'', r:'0 - 0.95' },
        ACRO_RP_RATE:     { d:'Maximum roll and pitch rate in acro mode', u:'deg/s', r:'1 - 500' },
        ACRO_RP_RATE_TC:  { d:'Acro roll/pitch rate control input time constant', u:'s', r:'0 - 0.5' },
        ACRO_THR_MID:     { d:'Throttle mid-point in acro mode', u:'', r:'0 - 1' },
        ACRO_TRAINER:     { d:'Trainer mode: 0=Disabled 1=Leveling 2=Leveling+Limited', u:'', r:'0:Disabled,1:Leveling,2:Leveling and Limited' },
        ACRO_Y_EXPO:      { d:'Yaw expo', u:'', r:'0 - 0.95' },
        ACRO_Y_RATE:      { d:'Maximum yaw rate in acro mode', u:'deg/s', r:'1 - 500' },
        ACRO_Y_RATE_TC:   { d:'Acro yaw rate control input time constant', u:'s', r:'0 - 0.5' },
        ADSB_TYPE:        { d:'ADSB receiver type', u:'', r:'0:Disabled,1:uAvionix-MAVLink,2:Sagetech,3:uAvionix-UCP' },
        AHRS_COMP_BETA:   { d:'Complementary filter beta', u:'', r:'0.001 - 0.5' },
        AHRS_EKF_TYPE:    { d:'Active EKF type', u:'', r:'2:EKF2,3:EKF3' },
        AHRS_GPS_GAIN:    { d:'AHRS GPS gain', u:'', r:'0 - 1' },
        AHRS_GPS_MINSATS: { d:'Minimum GPS satellites before using GPS for attitude', u:'', r:'0 - 10' },
        AHRS_GPS_USE:     { d:'Use GPS for attitude estimation', u:'', r:'0:Disabled,1:Enabled' },
        AHRS_OPTIONS:     { d:'AHRS options bitmask', u:'', r:'' },
        AHRS_ORIENTATION: { d:'Board orientation', u:'', r:'0:None,1:Yaw45,2:Yaw90,3:Yaw135,4:Yaw180,5:Yaw225,6:Yaw270,7:Yaw315,8:Roll180' },
        AHRS_ORIGIN_ALT:  { d:'Altitude of home above sea level', u:'m', r:'' },
        AHRS_RP_P:        { d:'Roll/pitch P gain', u:'', r:'0.05 - 0.5' },
        AHRS_TRIM_X:      { d:'AHRS trim around X axis', u:'rad', r:'-0.1745 - 0.1745' },
        AHRS_TRIM_Y:      { d:'AHRS trim around Y axis', u:'rad', r:'-0.1745 - 0.1745' },
        AHRS_TRIM_Z:      { d:'AHRS trim around Z axis', u:'rad', r:'-0.1745 - 0.1745' },
        AHRS_WIND_MAX:    { d:'Maximum wind speed estimate', u:'m/s', r:'0 - 127' },
        AHRS_YAW_P:       { d:'Yaw P gain', u:'', r:'0.1 - 0.4' },
        ARMING_CHECK:     { d:'Arming checks bitmask', u:'', r:'0:Disabled,1:Barometer,2:Compass,4:GPS,8:INS,16:Parameters,32:RC,64:Voltage,128:Battery,65535:All' },
        ARMING_MIN_VOLT:  { d:'Minimum battery voltage to arm', u:'V', r:'0 - 25' },
        ARMING_OPTIONS:   { d:'Arming options bitmask', u:'', r:'' },
        ARMING_RUDDER:    { d:'Arm/disarm with rudder', u:'', r:'0:Disabled,1:ArmOnly,2:ArmOrDisarm' },
        ARMING_VOLT_MIN:  { d:'Minimum voltage to arm', u:'V', r:'0 - 25' },
        AUTOTUNE_AGGR:    { d:'Autotune aggressiveness', u:'', r:'0.05 - 0.1' },
        AUTOTUNE_AXES:    { d:'Autotune axes: 1=Roll 2=Pitch 4=Yaw', u:'', r:'1:Roll,2:Pitch,4:Yaw,7:All' },
        AUTOTUNE_GMBK:    { d:'Autotune gain margin backoff', u:'', r:'0.1 - 0.9' },
        AUTOTUNE_MIN_D:   { d:'Autotune minimum D gain', u:'', r:'0.001 - 0.006' },
        AVOID_ACCEL_MAX:  { d:'Maximum acceleration with avoidance', u:'m/s/s', r:'0 - 9' },
        AVOID_ALT_MIN:    { d:'Avoidance minimum altitude', u:'m', r:'0 - 10' },
        AVOID_BACKUP_DZ:  { d:'Avoidance backup deadzone', u:'m', r:'0 - 2' },
        AVOID_BACKUP_SPD: { d:'Avoidance maximum backup speed', u:'m/s', r:'0 - 2' },
        AVOID_BACKZ_SPD:  { d:'Avoidance maximum vertical backup speed', u:'m/s', r:'0 - 2' },
        AVOID_BEHAVE:     { d:'Avoidance behaviour', u:'', r:'0:Slide,1:Stop' },
        AVOID_DIST_MAX:   { d:'Maximum avoidance distance', u:'m', r:'0 - 30' },
        AVOID_ENABLE:     { d:'Avoidance enable bitmask', u:'', r:'0:Disabled,1:Enabled,2:UseProximitySensor,3:All' },
        AVOID_MARGIN:     { d:'Avoidance distance margin', u:'m', r:'0 - 10' },
        BARO1_GND_PRESS:  { d:'Barometer 1 ground pressure at startup', u:'Pa', r:'' },
        BARO2_GND_PRESS:  { d:'Barometer 2 ground pressure at startup', u:'Pa', r:'' },
        BARO3_GND_PRESS:  { d:'Barometer 3 ground pressure at startup', u:'Pa', r:'' },
        BARO1_DEVID:      { d:'Barometer 1 device ID', u:'', r:'' },
        BARO2_DEVID:      { d:'Barometer 2 device ID', u:'', r:'' },
        BARO3_DEVID:      { d:'Barometer 3 device ID', u:'', r:'' },
        BARO_ALT_OFFSET:  { d:'Altitude offset added to barometric altitude', u:'m', r:'' },
        BARO_EXT_BUS:     { d:'External barometer bus', u:'', r:'-1:Auto,0:I2C Internal,1:I2C External,2:SPI' },
        BARO_FIELD_ELV:   { d:'Field elevation at arming', u:'m', r:'' },
        BARO_FLTR_RNG:    { d:'Range for baro height filter', u:'m', r:'0 - 20' },
        BARO_GND_TEMP:    { d:'User-set ground temperature', u:'degC', r:'' },
        BARO_OPTIONS:     { d:'Barometer options bitmask', u:'', r:'' },
        BARO_PRIMARY:     { d:'Primary barometer', u:'', r:'0:FirstBaro,1:SecondBaro,2:ThirdBaro' },
        BARO_PROBE_EXT:   { d:'External barometers to probe', u:'', r:'' },
        BARO_ALTERR_MAX:  { d:'Maximum altitude error between barometers', u:'m', r:'0 - 5000' },
        BATT_CAPACITY:    { d:'Battery capacity', u:'mAh', r:'0 - 100000' },
        BATT_CRT_VOLT:    { d:'Critical battery voltage', u:'V', r:'0 - 25' },
        BATT_LOW_VOLT:    { d:'Low battery voltage', u:'V', r:'0 - 25' },
        BATT_MONITOR:     { d:'Battery monitoring type', u:'', r:'0:Disabled,3:Analog Voltage,4:Analog Volt+Curr,5:Solo,6:Bebop,7:SMBus,9:ESC BLHeli,10:Sum' },
        EK2_ENABLE:       { d:'Enable EKF2', u:'', r:'0:Disabled,1:Enabled' },
        EK3_ENABLE:       { d:'Enable EKF3', u:'', r:'0:Disabled,1:Enabled' },
        EK3_ACC_BIAS_LIM: { d:'EKF3 accelerometer bias limit', u:'m/s/s', r:'0.5 - 2.5' },
        EK3_ACC_P_NSE:    { d:'EKF3 accelerometer process noise', u:'m/s/s', r:'0.05 - 1' },
        EK3_ALT_M_NSE:    { d:'EKF3 altitude measurement noise', u:'m', r:'0.1 - 10' },
        EK3_ABIAS_P_NSE:  { d:'EKF3 accelerometer bias process noise', u:'m/s/s', r:'1e-6 - 0.001' },
        EK3_BCN_DELAY:    { d:'EKF3 beacon measurement delay', u:'ms', r:'0 - 250' },
        EK3_BCN_I_GTE:    { d:'EKF3 beacon innovation gate', u:'', r:'100 - 1000' },
        EK3_BCN_M_NSE:    { d:'EKF3 beacon measurement noise', u:'m', r:'0.1 - 10' },
        EK3_CHECK_SCALE:  { d:'EKF3 innovation check scale factor', u:'%', r:'100 - 200' },
        EK3_DRAG_BCOEF_X: { d:'EKF3 ballistic coefficient X', u:'kg/m²', r:'0 - 1000' },
        EK3_DRAG_BCOEF_Y: { d:'EKF3 ballistic coefficient Y', u:'kg/m²', r:'0 - 1000' },
        EK3_DRAG_M_NSE:   { d:'EKF3 drag measurement noise', u:'m/s/s', r:'0.1 - 10' },
        EK3_DRAG_MCOEF:   { d:'EKF3 momentum drag coefficient', u:'kg/m/s', r:'0 - 1' },
        EK3_EAS_I_GATE:   { d:'EKF3 airspeed innovation gate', u:'', r:'100 - 1000' },
        EK3_EAS_M_NSE:    { d:'EKF3 airspeed measurement noise', u:'m/s', r:'0.5 - 5' },
        EK3_ERR_THRESH:   { d:'EKF3 primary core error threshold', u:'', r:'0.05 - 1' },
        EK3_FLOW_DELAY:   { d:'EKF3 optical flow measurement delay', u:'ms', r:'0 - 127' },
        EK3_FLOW_I_GATE:  { d:'EKF3 optical flow innovation gate', u:'', r:'100 - 1000' },
        EK3_FLOW_M_NSE:   { d:'EKF3 optical flow measurement noise', u:'rad/s', r:'0.05 - 1' },
        EK3_FLOW_MAX:     { d:'EKF3 optical flow maximum valid rate', u:'rad/s', r:'1 - 4' },
        EK3_FLOW_USE:     { d:'EKF3 optical flow usage', u:'', r:'0:OptionalRotVel,1:RotVelAndPos,2:RotVelOnly' },
        EK3_GBIAS_P_NSE:  { d:'EKF3 gyro bias process noise', u:'rad/s', r:'1e-7 - 0.001' },
        EK3_GND_EFF_DZ:   { d:'EKF3 baro ground effect deadzone', u:'m', r:'0 - 10' },
        EK3_GLITCH_RAD:   { d:'EKF3 GPS glitch radius', u:'m', r:'10 - 100' },
        EK3_GPS_CHECK:    { d:'EKF3 GPS pre-arm check bitmask', u:'', r:'' },
        EK3_GPS_VACC_MAX: { d:'EKF3 GPS max vertical accuracy', u:'m', r:'0 - 10' },
        EK3_GSF_RST_MAX:  { d:'EKF3 GSF yaw reset limit', u:'', r:'1 - 10' },
        EK3_GSF_RUN_MASK: { d:'EKF3 GSF run mask', u:'', r:'' },
        EK3_GSF_USE_MASK: { d:'EKF3 GSF use mask', u:'', r:'' },
        EK3_GYRO_P_NSE:   { d:'EKF3 gyro measurement noise', u:'rad/s', r:'0.0001 - 0.1' },
        EK3_HGT_DELAY:    { d:'EKF3 height measurement delay', u:'ms', r:'0 - 250' },
        EK3_HGT_I_GATE:   { d:'EKF3 height innovation gate', u:'', r:'100 - 1000' },
        EK3_HRT_FILT:     { d:'EKF3 heartbeat filter cutoff frequency', u:'Hz', r:'0.1 - 30' },
        EK3_IMU_MASK:     { d:'EKF3 IMU bitmask', u:'', r:'1:FirstIMU,2:SecondIMU,3:Both' },
        EK3_LOG_LEVEL:    { d:'EKF3 logging level', u:'', r:'0:Minimal,1:Intermediate,2:Full,3:Disabled' },
        EK3_MAG_CAL:      { d:'EKF3 magnetometer calibration', u:'', r:'0:Never,1:WhenFlying,2:Always,3:EKF,4:Disabled' },
        EK3_MAG_EF_LIM:   { d:'EKF3 earth field limit', u:'%', r:'0 - 100' },
        EK3_MAG_I_GATE:   { d:'EKF3 magnetometer innovation gate', u:'', r:'100 - 1000' },
        EK3_MAG_M_NSE:    { d:'EKF3 magnetometer measurement noise', u:'Gauss', r:'0.01 - 0.5' },
        EK3_MAGE_P_NSE:   { d:'EKF3 earth magnetic field process noise', u:'Gauss/s', r:'1e-5 - 0.01' },
        EK3_MAGB_P_NSE:   { d:'EKF3 body magnetic field process noise', u:'Gauss/s', r:'1e-6 - 0.01' },
        EK3_NOAID_M_NSE:  { d:'EKF3 non-aiding measurement noise', u:'m/s', r:'0.5 - 50' },
        EK3_OPTIONS:      { d:'EKF3 options bitmask', u:'', r:'' },
        EK3_POS_I_GATE:   { d:'EKF3 GPS position innovation gate', u:'', r:'100 - 1000' },
        EK3_POSNE_M_NSE:  { d:'EKF3 GPS horizontal position noise', u:'m', r:'0.1 - 10' },
        EK3_PRIMARY:      { d:'EKF3 primary core number', u:'', r:'0:First,1:Second,2:Third,3:Fourth,4:Fifth,5:Sixth' },
        EK3_RNG_I_GATE:   { d:'EKF3 range finder innovation gate', u:'', r:'100 - 1000' },
        EK3_RNG_M_NSE:    { d:'EKF3 range finder measurement noise', u:'m', r:'0.1 - 10' },
        EK3_RNG_USE_HGT:  { d:'EKF3 range finder switch height (-1=disable)', u:'m', r:'-1 - 70' },
        EK3_RNG_USE_SPD:  { d:'EKF3 range finder max ground speed', u:'m/s', r:'0 - 10' },
        EK3_SRC1_POSXY:   { d:'EKF3 source 1 horizontal position', u:'', r:'0:None,3:GPS,4:Beacon,6:ExternalNav' },
        EK3_SRC1_POSZ:    { d:'EKF3 source 1 vertical position', u:'', r:'1:Baro,2:RangeFinder,3:GPS,4:Beacon,6:ExternalNav' },
        EK3_SRC1_VELXY:   { d:'EKF3 source 1 horizontal velocity', u:'', r:'0:None,3:GPS,5:OpticalFlow,6:ExternalNav,7:WheelEncoder' },
        EK3_SRC1_VELZ:    { d:'EKF3 source 1 vertical velocity', u:'', r:'0:None,3:GPS,6:ExternalNav' },
        EK3_SRC1_YAW:     { d:'EKF3 source 1 yaw', u:'', r:'1:Compass,2:GPS,3:GPSWithCompass,6:ExternalNav' },
        EK3_SRC2_POSXY:   { d:'EKF3 source 2 horizontal position', u:'', r:'0:None,3:GPS,4:Beacon,6:ExternalNav' },
        EK3_SRC2_POSZ:    { d:'EKF3 source 2 vertical position', u:'', r:'1:Baro,2:RangeFinder,3:GPS,4:Beacon,6:ExternalNav' },
        EK3_SRC2_VELXY:   { d:'EKF3 source 2 horizontal velocity', u:'', r:'0:None,3:GPS,5:OpticalFlow,6:ExternalNav,7:WheelEncoder' },
        EK3_SRC2_VELZ:    { d:'EKF3 source 2 vertical velocity', u:'', r:'0:None,3:GPS,6:ExternalNav' },
        EK3_SRC2_YAW:     { d:'EKF3 source 2 yaw', u:'', r:'1:Compass,2:GPS,3:GPSWithCompass,6:ExternalNav' },
        EK3_SRC3_POSXY:   { d:'EKF3 source 3 horizontal position', u:'', r:'0:None,3:GPS,4:Beacon,6:ExternalNav' },
        EK3_SRC3_POSZ:    { d:'EKF3 source 3 vertical position', u:'', r:'1:Baro,2:RangeFinder,3:GPS,4:Beacon,6:ExternalNav' },
        EK3_SRC3_VELXY:   { d:'EKF3 source 3 horizontal velocity', u:'', r:'0:None,3:GPS,5:OpticalFlow,6:ExternalNav,7:WheelEncoder' },
        EK3_SRC3_VELZ:    { d:'EKF3 source 3 vertical velocity', u:'', r:'0:None,3:GPS,6:ExternalNav' },
        EK3_SRC3_YAW:     { d:'EKF3 source 3 yaw', u:'', r:'1:Compass,2:GPS,3:GPSWithCompass,6:ExternalNav' },
        EK3_SRC_OPTIONS:  { d:'EKF3 source options bitmask', u:'', r:'' },
        EK3_TAU_OUTPUT:   { d:'EKF3 output filter time constant', u:'centi-Hz', r:'10 - 50' },
        EK3_TERR_GRAD:    { d:'EKF3 maximum terrain gradient', u:'', r:'0 - 0.2' },
        EK3_VEL_I_GATE:   { d:'EKF3 GPS velocity innovation gate', u:'', r:'100 - 1000' },
        EK3_VELD_M_NSE:   { d:'EKF3 GPS vertical velocity noise', u:'m/s', r:'0.05 - 5' },
        EK3_VELNE_M_NSE:  { d:'EKF3 GPS horizontal velocity noise', u:'m/s', r:'0.05 - 5' },
        EK3_VIS_VERR_MAX: { d:'EKF3 visual odometry max velocity error', u:'m/s', r:'0 - 2' },
        EK3_VIS_VERR_MIN: { d:'EKF3 visual odometry min velocity error', u:'m/s', r:'0 - 0.5' },
        EK3_WENC_VERR:    { d:'EKF3 wheel encoder velocity error', u:'m/s', r:'0.01 - 1' },
        EK3_WIND_P_NSE:   { d:'EKF3 wind process noise', u:'m/s/s', r:'0.01 - 1' },
        EK3_WIND_PSCALE:  { d:'EKF3 wind process noise height scale', u:'', r:'0 - 1' },
        EK3_YAW_I_GATE:   { d:'EKF3 yaw innovation gate', u:'', r:'100 - 1000' },
        EK3_YAW_M_NSE:    { d:'EKF3 yaw measurement noise', u:'rad', r:'0.05 - 1.0' },
        FENCE_ACTION:     { d:'Fence breach action', u:'', r:'0:Report,1:RTL or Land,2:Always Land,3:SmartRTL,4:Brake or Land' },
        FENCE_ALT_MAX:    { d:'Fence maximum altitude', u:'m', r:'10 - 1000' },
        FENCE_ALT_MIN:    { d:'Fence minimum altitude', u:'m', r:'-100 - 100' },
        FENCE_AUTOENABLE: { d:'Fence auto-enable mode', u:'', r:'0:Disabled,1:WhenArmed,2:AfterTakeoff' },
        FENCE_ENABLE:     { d:'Fence enable', u:'', r:'0:Disabled,1:Enabled' },
        FENCE_MARGIN:     { d:'Fence margin distance', u:'m', r:'1 - 10' },
        FENCE_OPTIONS:    { d:'Fence options bitmask', u:'', r:'' },
        FENCE_RADIUS:     { d:'Circular fence radius', u:'m', r:'30 - 10000' },
        FENCE_TOTAL:      { d:'Number of polygon fence points', u:'', r:'' },
        FENCE_TYPE:       { d:'Fence type bitmask', u:'', r:'1:Max altitude,2:Circle,4:Polygon,7:All' },
        FS_BATT_ENABLE:   { d:'Battery failsafe enable', u:'', r:'0:Disabled,1:Land,2:RTL,3:SmartRTL,4:SmartRTLorLand,5:Terminate' },
        FS_DR_ENABLE:     { d:'Dead reckoning failsafe', u:'', r:'0:Disabled,1:Warn,2:RTL,3:SmartRTL,4:Land' },
        FS_DR_TIMEOUT:    { d:'Dead reckoning failsafe timeout', u:'s', r:'0 - 120' },
        FS_EKF_FILT:      { d:'EKF failsafe variance filter', u:'', r:'0 - 32' },
        FS_GCS_ENABLE:    { d:'GCS failsafe enable', u:'', r:'0:Disabled,1:AlwaysRTL,2:RTLorContinue,3:SmartRTL,4:SmartRTLorContinue,5:Land' },
        FS_GCS_TIMEOUT:   { d:'GCS failsafe timeout', u:'s', r:'2 - 120' },
        FS_OPTIONS:       { d:'Failsafe options bitmask', u:'', r:'' },
        FS_THR_ENABLE:    { d:'Throttle failsafe enable', u:'', r:'0:Disabled,1:AlwaysLand,2:AltHoldLand,3:AlwaysRTL,4:SmartRTLorLand' },
        FS_THR_VALUE:     { d:'Throttle failsafe PWM threshold', u:'PWM', r:'910 - 1100' },
        FS_VIBE_ENABLE:   { d:'Vibration failsafe enable', u:'', r:'0:Disabled,1:Enabled' },
        GPS_TYPE:         { d:'GPS type', u:'', r:'0:None,1:AUTO,2:uBlox,5:NMEA,6:SiRF,7:HIL,9:UAVCAN,10:SBF' },
        GPS1_TYPE:        { d:'GPS 1 type', u:'', r:'0:None,1:AUTO,2:uBlox,5:NMEA,6:SiRF,9:UAVCAN' },
        GPS2_TYPE:        { d:'GPS 2 type', u:'', r:'0:None,1:AUTO,2:uBlox,5:NMEA,6:SiRF' },
        GPS_AUTO_CONFIG:  { d:'Automatic GPS configuration', u:'', r:'0:Disabled,1:Enabled,2:EnabledWithSBAS' },
        GPS_AUTO_SWITCH:  { d:'Automatic GPS switching', u:'', r:'0:Disabled,1:UseBest,2:Blend,4:UseSecondary' },
        GPS_HDOP_GOOD:    { d:'HDOP threshold for good GPS fix', u:'', r:'1 - 9' },
        GPS_MIN_ELEV:     { d:'Minimum satellite elevation', u:'deg', r:'-100 - 90' },
        GPS_NAVFILTER:    { d:'Navigation filter setting', u:'', r:'0:Portable,2:Stationary,3:Pedestrian,4:Automotive,5:Sea,6:Airborne1G,7:Airborne2G,8:Airborne4G' },
        GPS_PRIMARY:      { d:'Primary GPS', u:'', r:'0:FirstGPS,1:SecondGPS' },
        GPS_SBAS_MODE:    { d:'SBAS mode', u:'', r:'0:Disabled,1:Enabled,2:Auto' },
        GPS1_COM_PORT:    { d:'GPS 1 serial port', u:'', r:'' },
        GPS1_DELAY_MS:    { d:'GPS 1 delay', u:'ms', r:'0 - 250' },
        GPS1_POS_X:       { d:'GPS 1 antenna X offset from CG', u:'m', r:'-5 - 5' },
        GPS1_POS_Y:       { d:'GPS 1 antenna Y offset from CG', u:'m', r:'-5 - 5' },
        GPS1_POS_Z:       { d:'GPS 1 antenna Z offset from CG', u:'m', r:'-5 - 5' },
        GPS1_RATE_MS:     { d:'GPS 1 update rate', u:'ms', r:'50 - 5000' },
        INS_ACCEL_FILTER: { d:'Accelerometer low-pass filter cutoff', u:'Hz', r:'0 - 256' },
        INS_GYRO_FILTER:  { d:'Gyro low-pass filter cutoff', u:'Hz', r:'0 - 256' },
        INS_FAST_SAMPLE:  { d:'Fast sampling bitmask', u:'', r:'1:FirstIMU,2:SecondIMU,3:Both' },
        INS_USE:          { d:'IMU 1 enable', u:'', r:'0:Disabled,1:Enabled' },
        INS_USE2:         { d:'IMU 2 enable', u:'', r:'0:Disabled,1:Enabled' },
        LOG_BITMASK:      { d:'Log bitmask', u:'', r:'0:Disabled,2:Attitude Fast,4:Attitude Med,8:GPS,16:PM,32:CTUN,64:NTUN,128:RCIN,256:IMU,512:CMD,1024:Current,4096:Motors,8192:Compass,65535:All' },
        LOG_BACKEND_TYPE: { d:'Log backend type', u:'', r:'0:None,1:File,2:DataFlash,3:Both' },
        LOG_DISARMED:     { d:'Enable logging when disarmed', u:'', r:'0:Disabled,1:Enabled' },
        LOG_FILE_BUFSIZE: { d:'Log file buffer size', u:'kB', r:'1 - 64' },
        LOG_FILE_MB_FREE: { d:'Minimum free MB before stopping log', u:'MB', r:'10 - 10000' },
        LOG_MAX_FILES:    { d:'Maximum log file count', u:'', r:'2 - 1000' },
        MOT_BAT_CURR_MAX: { d:'Maximum current for battery compensation', u:'A', r:'0 - 200' },
        MOT_BAT_VOLT_MAX: { d:'Battery voltage max for compensation', u:'V', r:'6 - 35' },
        MOT_BAT_VOLT_MIN: { d:'Battery voltage min for compensation', u:'V', r:'6 - 35' },
        MOT_HOVER_LEARN:  { d:'Hover throttle learning', u:'', r:'0:Disabled,1:Learn,2:LearnAndSave' },
        MOT_PWM_MAX:      { d:'ESC maximum PWM output', u:'PWM', r:'1000 - 2000' },
        MOT_PWM_MIN:      { d:'ESC minimum PWM output', u:'PWM', r:'1000 - 2000' },
        MOT_PWM_TYPE:     { d:'Motor PWM type', u:'', r:'0:Normal,1:OneShot,2:OneShot125,3:Brushed,4:DShot150,5:DShot300,6:DShot600,7:DShot1200' },
        MOT_SAFE_DISARM:  { d:'Motor safe disarm', u:'', r:'0:Disabled,1:SendZeroThrottle' },
        MOT_SPIN_ARM:     { d:'Motor spin when armed (fraction)', u:'', r:'0 - 0.3' },
        MOT_SPIN_MAX:     { d:'Motor spin maximum (fraction)', u:'', r:'0.9 - 1' },
        MOT_SPIN_MIN:     { d:'Motor spin minimum (fraction)', u:'', r:'0 - 0.3' },
        MOT_SPOOL_TIME:   { d:'Motor spool-up time', u:'s', r:'0 - 2' },
        MOT_THST_EXPO:    { d:'Motor thrust curve expo', u:'', r:'0.25 - 0.8' },
        MOT_THST_HOVER:   { d:'Hover throttle (fraction)', u:'', r:'0.2 - 0.8' },
        MOT_YAW_HEADROOM: { d:'Minimum motor output for yaw', u:'PWM', r:'0 - 500' },
        PILOT_ACC_Z:      { d:'Pilot vertical acceleration max', u:'m/s/s', r:'1 - 10' },
        PILOT_SPD_DN:     { d:'Pilot max descent speed', u:'m/s', r:'0 - 10' },
        PILOT_SPD_UP:     { d:'Pilot max climb speed', u:'m/s', r:'0.1 - 20' },
        PILOT_SPEED_DN:   { d:'Pilot max descent speed (legacy cm/s)', u:'cm/s', r:'0 - 1000' },
        PILOT_SPEED_UP:   { d:'Pilot max climb speed (legacy cm/s)', u:'cm/s', r:'10 - 2000' },
        PILOT_Y_EXPO:     { d:'Pilot yaw exponential', u:'', r:'0 - 0.95' },
        PILOT_Y_RATE:     { d:'Pilot maximum yaw rate', u:'deg/s', r:'1 - 360' },
        PILOT_Y_RATE_TC:  { d:'Pilot yaw rate time constant', u:'s', r:'0 - 0.5' },
        RALLY_INCL_HOME:  { d:'Include home as rally point', u:'', r:'0:Disabled,1:Enabled' },
        RALLY_LIMIT_KM:   { d:'Rally loiter radius limit', u:'km', r:'0 - 1000' },
        RALLY_TOTAL:      { d:'Number of rally points', u:'', r:'' },
        RC_SPEED:         { d:'ESC update speed', u:'Hz', r:'50 - 490' },
        RC_OPTIONS:       { d:'RC options bitmask', u:'', r:'' },
        RC_OVERRIDE_TIME: { d:'RC override timeout', u:'s', r:'0 - 3' },
        RC_PROTOCOLS:     { d:'RC input protocols bitmask', u:'', r:'' },
        RC_FS_TIMEOUT:    { d:'RC failsafe timeout', u:'s', r:'0.5 - 10' },
        RCMAP_PITCH:      { d:'Pitch RC channel number', u:'', r:'1 - 8' },
        RCMAP_ROLL:       { d:'Roll RC channel number', u:'', r:'1 - 8' },
        RCMAP_THROTTLE:   { d:'Throttle RC channel number', u:'', r:'1 - 8' },
        RCMAP_YAW:        { d:'Yaw RC channel number', u:'', r:'1 - 8' },
        RTL_ALT_M:        { d:'RTL return altitude', u:'m', r:'1 - 300' },
        RTL_ALT_FINAL_M:  { d:'RTL final altitude', u:'m', r:'0 - 10' },
        RTL_CLIMB_MIN_M:  { d:'RTL minimum climb', u:'m', r:'0 - 3000' },
        RTL_SPEED_MS:     { d:'RTL return speed', u:'m/s', r:'0 - 20' },
        RTL_OPTIONS:      { d:'RTL options bitmask', u:'', r:'' },
        SCHED_DEBUG:      { d:'Scheduler debug level', u:'', r:'0:Disabled,2:ShowSlips,3:ShowOverruns' },
        SCHED_LOOP_RATE:  { d:'Scheduler loop rate', u:'Hz', r:'50 - 400' },
        SCHED_OPTIONS:    { d:'Scheduler options bitmask', u:'', r:'' },
        STAT_BOOTCNT:     { d:'Boot count', u:'', r:'' },
        STAT_DISTFLWN:    { d:'Total distance flown', u:'m', r:'' },
        STAT_FLTCNT:      { d:'Total flight count', u:'', r:'' },
        STAT_FLTTIME:     { d:'Total flight time', u:'s', r:'' },
        STAT_RESET:       { d:'Reset statistics', u:'', r:'0:Disabled,1:Reset' },
        STAT_RUNTIME:     { d:'Total runtime', u:'s', r:'' },
        TERRAIN_ENABLE:   { d:'Enable terrain database', u:'', r:'0:Disabled,1:Enabled' },
        TERRAIN_SPACING:  { d:'Terrain grid spacing', u:'m', r:'100 - 2000' },
        TERRAIN_MARGIN:   { d:'Terrain lookahead safety margin', u:'m', r:'0.1 - 10' },
        WPNAV_SPEED:      { d:'Waypoint cruise speed', u:'cm/s', r:'20 - 2000' },
        WPNAV_SPEED_UP:   { d:'Waypoint climb speed', u:'cm/s', r:'10 - 1000' },
        WPNAV_SPEED_DN:   { d:'Waypoint descent speed', u:'cm/s', r:'10 - 500' },
        WPNAV_ACCEL:      { d:'Waypoint horizontal acceleration', u:'cm/s/s', r:'50 - 500' },
        WPNAV_RADIUS:     { d:'Waypoint acceptance radius', u:'cm', r:'5 - 1000' },
        MAV_SYSID:        { d:'MAVLink system ID of this autopilot', u:'', r:'1 - 255' },
        MAV_GCS_SYSID:    { d:'Ground station MAVLink system ID', u:'', r:'1 - 255' },
        MAV_OPTIONS:      { d:'MAVLink options bitmask', u:'', r:'' },
        MAV_TELEM_DELAY:  { d:'Telemetry start-up delay', u:'s', r:'0 - 30' },
        SERIAL0_BAUD:     { d:'USB baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,19:19200,38:38400,57:57600,111:111100,115:115200,230:230400,460:460800,921:921600,1500:1500000' },
        SERIAL0_PROTOCOL: { d:'USB protocol', u:'', r:'1:MAVLink1,2:MAVLink2,5:GPS' },
        SERIAL1_BAUD:     { d:'Telemetry 1 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,460:460800,921:921600' },
        SERIAL1_PROTOCOL: { d:'Telemetry 1 protocol', u:'', r:'1:MAVLink1,2:MAVLink2,5:GPS,10:FrSky Passthrough,19:FrSky D' },
        SERIAL2_BAUD:     { d:'Telemetry 2 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,921:921600' },
        SERIAL2_PROTOCOL: { d:'Telemetry 2 protocol', u:'', r:'1:MAVLink1,2:MAVLink2,5:GPS' },
        SERIAL3_BAUD:     { d:'Serial 3 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,921:921600' },
        SERIAL3_PROTOCOL: { d:'Serial 3 protocol', u:'', r:'1:MAVLink1,2:MAVLink2,5:GPS' },
        SERIAL4_BAUD:     { d:'Serial 4 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,921:921600' },
        SERIAL4_PROTOCOL: { d:'Serial 4 protocol', u:'', r:'1:MAVLink1,2:MAVLink2,5:GPS' },
        SERIAL5_BAUD:     { d:'Serial 5 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,921:921600' },
        SERIAL5_PROTOCOL: { d:'Serial 5 protocol', u:'', r:'-1:None,1:MAVLink1,2:MAVLink2,5:GPS' },
        SERIAL6_BAUD:     { d:'Serial 6 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,921:921600' },
        SERIAL6_PROTOCOL: { d:'Serial 6 protocol', u:'', r:'-1:None,1:MAVLink1,2:MAVLink2,5:GPS' },
        SERIAL7_BAUD:     { d:'Serial 7 baud rate', u:'kbps', r:'1:1200,2:2400,4:4800,9:9600,57:57600,115:115200,230:230400,921:921600' },
        SERIAL7_PROTOCOL: { d:'Serial 7 protocol', u:'', r:'-1:None,1:MAVLink1,2:MAVLink2,5:GPS' },
        FRAME_CLASS:      { d:'Multicopter frame class', u:'', r:'0:Undefined,1:Quad,2:Hexa,3:Octa,4:OctaQuad,5:Y6,6:Heli,7:Tri,12:DodecaHexa,14:Deca' },
        GND_EFFECT_COMP:  { d:'Ground effect compensation', u:'', r:'0:Disabled,1:Enabled' },
        MIS_OPTIONS:      { d:'Mission options bitmask', u:'', r:'' },
        MIS_RESTART:      { d:'Mission restart on reboot', u:'', r:'0:ContinueMission,1:RestartMission' },
        MIS_TOTAL:        { d:'Number of mission items', u:'', r:'' },
        NTF_BUZZ_VOLUME:  { d:'Buzzer volume', u:'%', r:'0 - 100' },
        NTF_LED_BRIGHT:   { d:'LED brightness', u:'', r:'0:Off,1:Low,2:Medium,3:High' },
        NTF_LED_LEN:      { d:'RGB LED string length', u:'', r:'1 - 32' },
        RSSI_TYPE:        { d:'RSSI type', u:'', r:'0:Disabled,1:AnalogPin,2:RCChannelPwmValue,3:ReceiverProtocol,4:PWMInputPin' },
        FLTMODE1:         { d:'Flight mode 1 (lowest switch position)', u:'', r:'0:Stabilize,1:Acro,2:AltHold,3:Auto,4:Guided,5:Loiter,6:RTL,7:Circle,9:Land,11:Drift,13:Sport,14:Flip,15:AutoTune,16:PosHold,17:Brake,18:Throw,19:Avoid_ADSB,20:Guided_NoGPS,21:SmartRTL,24:Follow,25:ZigZag' },
        FLTMODE2:         { d:'Flight mode 2', u:'', r:'0:Stabilize,1:Acro,2:AltHold,3:Auto,4:Guided,5:Loiter,6:RTL,7:Circle,9:Land,11:Drift,13:Sport,16:PosHold,17:Brake,18:Throw,21:SmartRTL,24:Follow,25:ZigZag' },
        FLTMODE3:         { d:'Flight mode 3', u:'', r:'0:Stabilize,1:Acro,2:AltHold,3:Auto,4:Guided,5:Loiter,6:RTL,7:Circle,9:Land,11:Drift,13:Sport,16:PosHold,17:Brake,18:Throw,21:SmartRTL,24:Follow,25:ZigZag' },
        FLTMODE4:         { d:'Flight mode 4', u:'', r:'0:Stabilize,1:Acro,2:AltHold,3:Auto,4:Guided,5:Loiter,6:RTL,7:Circle,9:Land,11:Drift,13:Sport,16:PosHold,17:Brake,18:Throw,21:SmartRTL,24:Follow,25:ZigZag' },
        FLTMODE5:         { d:'Flight mode 5', u:'', r:'0:Stabilize,1:Acro,2:AltHold,3:Auto,4:Guided,5:Loiter,6:RTL,7:Circle,9:Land,11:Drift,13:Sport,16:PosHold,17:Brake,18:Throw,21:SmartRTL,24:Follow,25:ZigZag' },
        FLTMODE6:         { d:'Flight mode 6 (highest switch position)', u:'', r:'0:Stabilize,1:Acro,2:AltHold,3:Auto,4:Guided,5:Loiter,6:RTL,7:Circle,9:Land,11:Drift,13:Sport,16:PosHold,17:Brake,18:Throw,21:SmartRTL,24:Follow,25:ZigZag' },
        FLTMODE_GCSBLOCK: { d:'Flight mode GCS block bitmask', u:'', r:'' },
        LAND_ALT_LOW_M:   { d:'Altitude where landing speed reduces', u:'m', r:'1 - 50' },
        LAND_SPD_HIGH_MS: { d:'Landing speed (high altitude)', u:'m/s', r:'0 - 10' },
        LAND_SPD_MS:      { d:'Landing speed (low altitude)', u:'m/s', r:'0.1 - 2' },
        THROW_NEXTMODE:   { d:'Flight mode after successful throw', u:'', r:'2:AltHold,3:Auto,5:Loiter,6:RTL,16:PosHold,17:Brake,18:Throw' },
        THROW_TYPE:       { d:'Throw type', u:'', r:'0:Upward,1:Drop' },

        // ── COMPASS parameters ─────────────────────────────────────────────────
        COMPASS_ENABLE:      { d:'Enable compass (magnetometer)', u:'', r:'0:Disabled,1:Enabled' },
        COMPASS_LEARN:       { d:'Compass learning mode', u:'', r:'0:Disabled,1:Internal,2:EKF,3:InFlight' },
        COMPASS_USE:         { d:'Use compass 1 for heading', u:'', r:'0:Disabled,1:Enabled' },
        COMPASS_USE2:        { d:'Use compass 2 for heading', u:'', r:'0:Disabled,1:Enabled' },
        COMPASS_USE3:        { d:'Use compass 3 for heading', u:'', r:'0:Disabled,1:Enabled' },
        COMPASS_AUTODEC:     { d:'Auto declination enable', u:'', r:'0:Disabled,1:Enabled' },
        COMPASS_MOTCT:       { d:'Motor interference compensation type', u:'', r:'0:Disabled,1:Throttle,2:Current' },
        COMPASS_OPTIONS:     { d:'Compass options bitmask', u:'', r:'0:None,1:CalRequiresLevel' },
        COMPASS_PRIMARY:     { d:'Primary compass index', u:'', r:'0:FirstCompass,1:SecondCompass,2:ThirdCompass' },
        COMPASS_EXTERN:      { d:'Compass 1 is external', u:'', r:'0:Internal,1:External' },
        COMPASS_EXTERN2:     { d:'Compass 2 is external', u:'', r:'0:Internal,1:External' },
        COMPASS_EXTERN3:     { d:'Compass 3 is external', u:'', r:'0:Internal,1:External' },
        COMPASS_ORIENT:      { d:'Compass 1 orientation', u:'', r:'0:None,1:Yaw45,2:Yaw90,3:Yaw135,4:Yaw180,5:Yaw225,6:Yaw270,7:Yaw315,8:Roll180' },
        COMPASS_ORIENT2:     { d:'Compass 2 orientation', u:'', r:'0:None,1:Yaw45,2:Yaw90,3:Yaw135,4:Yaw180,5:Yaw225,6:Yaw270,7:Yaw315,8:Roll180' },
        COMPASS_ORIENT3:     { d:'Compass 3 orientation', u:'', r:'0:None,1:Yaw45,2:Yaw90,3:Yaw135,4:Yaw180,5:Yaw225,6:Yaw270,7:Yaw315,8:Roll180' },

        // ── INS (Inertial Navigation System) ──────────────────────────────────
        INS_ENABLE_MASK:  { d:'IMU enable bitmask', u:'', r:'1:FirstIMU,2:SecondIMU,3:Both' },
        INS_UPDATE_RATE:  { d:'INS update rate', u:'Hz', r:'50:50Hz,100:100Hz,200:200Hz,400:400Hz' },
        INS_GYRO_CAL:     { d:'Gyro calibration scheme', u:'', r:'0:Never,1:StartupOnly' },
        INS_TRIM_OPTION:  { d:'Trim option at startup', u:'', r:'0:Disabled,1:Log2Learn,2:UseDisarmed' },
        INS_GYR_ID:       { d:'Gyro 1 device ID (auto-detected)', u:'', r:'' },
        INS_GYR2_ID:      { d:'Gyro 2 device ID (auto-detected)', u:'', r:'' },
        INS_GYR3_ID:      { d:'Gyro 3 device ID (auto-detected)', u:'', r:'' },
        INS_ACC_ID:       { d:'Accelerometer 1 device ID (auto-detected)', u:'', r:'' },
        INS_ACC2_ID:      { d:'Accelerometer 2 device ID (auto-detected)', u:'', r:'' },
        INS_ACC3_ID:      { d:'Accelerometer 3 device ID (auto-detected)', u:'', r:'' },
        INS_ACCOFFS_X:    { d:'Accelerometer 1 X-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACCOFFS_Y:    { d:'Accelerometer 1 Y-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACCOFFS_Z:    { d:'Accelerometer 1 Z-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACCSCAL_X:    { d:'Accelerometer 1 X-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACCSCAL_Y:    { d:'Accelerometer 1 Y-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACCSCAL_Z:    { d:'Accelerometer 1 Z-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACC2OFFS_X:   { d:'Accelerometer 2 X-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACC2OFFS_Y:   { d:'Accelerometer 2 Y-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACC2OFFS_Z:   { d:'Accelerometer 2 Z-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACC2SCAL_X:   { d:'Accelerometer 2 X-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACC2SCAL_Y:   { d:'Accelerometer 2 Y-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACC2SCAL_Z:   { d:'Accelerometer 2 Z-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACC3OFFS_X:   { d:'Accelerometer 3 X-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACC3OFFS_Y:   { d:'Accelerometer 3 Y-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACC3OFFS_Z:   { d:'Accelerometer 3 Z-axis offset', u:'m/s/s', r:'-3.5 - 3.5' },
        INS_ACC3SCAL_X:   { d:'Accelerometer 3 X-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACC3SCAL_Y:   { d:'Accelerometer 3 Y-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_ACC3SCAL_Z:   { d:'Accelerometer 3 Z-axis scale factor', u:'', r:'0.8 - 1.2' },
        INS_GYROFFS_X:    { d:'Gyro 1 X-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYROFFS_Y:    { d:'Gyro 1 Y-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYROFFS_Z:    { d:'Gyro 1 Z-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR2OFFS_X:   { d:'Gyro 2 X-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR2OFFS_Y:   { d:'Gyro 2 Y-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR2OFFS_Z:   { d:'Gyro 2 Z-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR3OFFS_X:   { d:'Gyro 3 X-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR3OFFS_Y:   { d:'Gyro 3 Y-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR3OFFS_Z:   { d:'Gyro 3 Z-axis offset', u:'rad/s', r:'-0.2 - 0.2' },
        INS_GYR_CAL_TEMP: { d:'Gyro calibration temperature', u:'degC', r:'-300 - 100' },
        INS_TCAL_ENABLE:  { d:'Temperature calibration enable', u:'', r:'0:Disabled,1:Enabled,2:LearnCalibration' },
        INS_POS1_X:       { d:'IMU 1 X position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS1_Y:       { d:'IMU 1 Y position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS1_Z:       { d:'IMU 1 Z position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS2_X:       { d:'IMU 2 X position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS2_Y:       { d:'IMU 2 Y position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS2_Z:       { d:'IMU 2 Z position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS3_X:       { d:'IMU 3 X position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS3_Y:       { d:'IMU 3 Y position offset from CG', u:'m', r:'-5 - 5' },
        INS_POS3_Z:       { d:'IMU 3 Z position offset from CG', u:'m', r:'-5 - 5' },
        INS_USE:          { d:'Use IMU for estimation', u:'', r:'0:Disabled,1:Enabled' },
        INS_USE2:         { d:'Use IMU 2 for estimation', u:'', r:'0:Disabled,1:Enabled' },
        INS_USE3:         { d:'Use IMU 3 for estimation', u:'', r:'0:Disabled,1:Enabled' },

        // ── LAND ──────────────────────────────────────────────────────────────
        LAND_ALT_LOW:     { d:'Altitude to switch to lower landing speed', u:'cm', r:'100 - 10000' },
        LAND_REPOSITION:  { d:'Allow repositioning during auto-land', u:'', r:'0:Disabled,1:Enabled' },
        LAND_SPEED:       { d:'Landing descent speed (below LAND_ALT_LOW)', u:'cm/s', r:'30 - 200' },
        LAND_SPEED_HIGH:  { d:'Landing descent speed (above LAND_ALT_LOW; 0=use WPNAV_SPEED_DN)', u:'cm/s', r:'0 - 500' },
        LAND_ABORT_DEG:   { d:'Land abort angle — abort if leaning more than this', u:'deg', r:'1 - 30' },
        LAND_ACCEL_Z:     { d:'Vertical acceleration during landing approach', u:'cm/s/s', r:'10 - 500' },
        LAND_WITH_SPEED:  { d:'Land with speed control (requires rangefinder)', u:'', r:'0:Disabled,1:Enabled' },

        // ── KDE (KDE motor driver) ─────────────────────────────────────────────
        KDE_NPOLE:        { d:'Number of motor poles (KDE/T-Motor ESC)', u:'', r:'2 - 100' },

        // ── ATC (Attitude Controller) ──────────────────────────────────────────
        ATC_ACCEL_P_MAX:  { d:'Pitch acceleration maximum', u:'cdeg/s/s', r:'0 - 180000' },
        ATC_ACCEL_R_MAX:  { d:'Roll acceleration maximum', u:'cdeg/s/s', r:'0 - 180000' },
        ATC_ACCEL_Y_MAX:  { d:'Yaw acceleration maximum', u:'cdeg/s/s', r:'0 - 72000' },
        ATC_ANG_LIM_TC:   { d:'Angle limit (to restore) time constant', u:'s', r:'0 - 10' },
        ATC_ANG_PIT_P:    { d:'Pitch angle controller P gain', u:'', r:'3 - 12' },
        ATC_ANG_RLL_P:    { d:'Roll angle controller P gain', u:'', r:'3 - 12' },
        ATC_ANG_YAW_P:    { d:'Yaw angle controller P gain', u:'', r:'3 - 12' },
        ATC_HOVR_ROL_TRM: { d:'Hover roll trim angle', u:'cdeg', r:'-1000 - 1000' },
        ATC_INPUT_TC:     { d:'Attitude control input time constant', u:'s', r:'0 - 1' },
        ATC_RATE_FF_ENAB: { d:'Rate feed-forward enable', u:'', r:'0:Disabled,1:Enabled' },
        ATC_RATE_P_MAX:   { d:'Pitch rate controller output maximum', u:'cdeg/s', r:'0 - 72000' },
        ATC_RATE_R_MAX:   { d:'Roll rate controller output maximum', u:'cdeg/s', r:'0 - 72000' },
        ATC_RATE_Y_MAX:   { d:'Yaw rate controller output maximum', u:'cdeg/s', r:'0 - 72000' },
        ATC_RAT_PIT_D:    { d:'Pitch rate controller D gain', u:'', r:'0.0001 - 0.03' },
        ATC_RAT_PIT_FF:   { d:'Pitch rate controller feed-forward gain', u:'', r:'0 - 0.5' },
        ATC_RAT_PIT_FLTD: { d:'Pitch rate D-term filter cutoff', u:'Hz', r:'1 - 100' },
        ATC_RAT_PIT_FLTE: { d:'Pitch rate error filter cutoff', u:'Hz', r:'0 - 100' },
        ATC_RAT_PIT_FLTT: { d:'Pitch rate target filter cutoff', u:'Hz', r:'1 - 100' },
        ATC_RAT_PIT_I:    { d:'Pitch rate controller I gain', u:'', r:'0.01 - 0.5' },
        ATC_RAT_PIT_IMAX: { d:'Pitch rate controller I-term maximum', u:'', r:'0 - 1' },
        ATC_RAT_PIT_P:    { d:'Pitch rate controller P gain', u:'', r:'0.01 - 0.5' },
        ATC_RAT_RLL_D:    { d:'Roll rate controller D gain', u:'', r:'0.0001 - 0.03' },
        ATC_RAT_RLL_FF:   { d:'Roll rate controller feed-forward gain', u:'', r:'0 - 0.5' },
        ATC_RAT_RLL_FLTD: { d:'Roll rate D-term filter cutoff', u:'Hz', r:'1 - 100' },
        ATC_RAT_RLL_FLTE: { d:'Roll rate error filter cutoff', u:'Hz', r:'0 - 100' },
        ATC_RAT_RLL_FLTT: { d:'Roll rate target filter cutoff', u:'Hz', r:'1 - 100' },
        ATC_RAT_RLL_I:    { d:'Roll rate controller I gain', u:'', r:'0.01 - 0.5' },
        ATC_RAT_RLL_IMAX: { d:'Roll rate controller I-term maximum', u:'', r:'0 - 1' },
        ATC_RAT_RLL_P:    { d:'Roll rate controller P gain', u:'', r:'0.01 - 0.5' },
        ATC_RAT_YAW_D:    { d:'Yaw rate controller D gain', u:'', r:'0 - 0.02' },
        ATC_RAT_YAW_FF:   { d:'Yaw rate controller feed-forward gain', u:'', r:'0 - 0.5' },
        ATC_RAT_YAW_FLTD: { d:'Yaw rate D-term filter cutoff', u:'Hz', r:'1 - 100' },
        ATC_RAT_YAW_FLTE: { d:'Yaw rate error filter cutoff', u:'Hz', r:'0 - 100' },
        ATC_RAT_YAW_FLTT: { d:'Yaw rate target filter cutoff', u:'Hz', r:'1 - 100' },
        ATC_RAT_YAW_I:    { d:'Yaw rate controller I gain', u:'', r:'0.005 - 0.5' },
        ATC_RAT_YAW_IMAX: { d:'Yaw rate controller I-term maximum', u:'', r:'0 - 1' },
        ATC_RAT_YAW_P:    { d:'Yaw rate controller P gain', u:'', r:'0.1 - 0.5' },
        ATC_SLEW_YAW:     { d:'Maximum yaw slew rate', u:'cdeg/s', r:'500 - 18000' },
        ATC_THR_G_BOOST:  { d:'Throttle-mix-at-G-transition boost', u:'', r:'0 - 1' },
        ATC_THR_MIX_MAN:  { d:'Throttle vs attitude mix (manual)', u:'', r:'0.1 - 0.9' },
        ATC_THR_MIX_MAX:  { d:'Throttle vs attitude mix maximum', u:'', r:'0.5 - 0.9' },
        ATC_THR_MIX_MIN:  { d:'Throttle vs attitude mix minimum', u:'', r:'0.1 - 0.25' },

        // ── PSC (Position and Speed Controller) ───────────────────────────────
        PSC_ACCZ_D:       { d:'Vertical acceleration controller D gain', u:'', r:'0 - 0.03' },
        PSC_ACCZ_FLTD:    { d:'Vertical accel D-term filter cutoff', u:'Hz', r:'1 - 100' },
        PSC_ACCZ_FLTE:    { d:'Vertical accel error filter cutoff', u:'Hz', r:'1 - 100' },
        PSC_ACCZ_FLTT:    { d:'Vertical accel target filter cutoff', u:'Hz', r:'1 - 100' },
        PSC_ACCZ_I:       { d:'Vertical acceleration controller I gain', u:'', r:'0.01 - 1' },
        PSC_ACCZ_IMAX:    { d:'Vertical accel I-term maximum (throttle %)', u:'', r:'0 - 1' },
        PSC_ACCZ_P:       { d:'Vertical acceleration controller P gain', u:'', r:'0.1 - 0.5' },
        PSC_ANGLE_MAX:    { d:'Maximum lean angle', u:'cdeg', r:'1000 - 8000' },
        PSC_JERK_XY:      { d:'Horizontal jerk limit', u:'m/s/s/s', r:'1 - 20' },
        PSC_JERK_Z:       { d:'Vertical jerk limit', u:'m/s/s/s', r:'5 - 50' },
        PSC_POSXY_P:      { d:'Horizontal position controller P gain', u:'', r:'0.1 - 2' },
        PSC_POSZ_P:       { d:'Vertical position controller P gain', u:'', r:'0.1 - 1' },
        PSC_VELXY_D:      { d:'Horizontal velocity controller D gain', u:'', r:'0 - 1' },
        PSC_VELXY_FLTD:   { d:'Horizontal velocity D-term filter cutoff', u:'Hz', r:'0 - 100' },
        PSC_VELXY_FLTE:   { d:'Horizontal velocity error filter cutoff', u:'Hz', r:'0 - 100' },
        PSC_VELXY_I:      { d:'Horizontal velocity controller I gain', u:'', r:'0 - 1' },
        PSC_VELXY_IMAX:   { d:'Horizontal velocity I-term maximum', u:'', r:'0 - 4500' },
        PSC_VELXY_P:      { d:'Horizontal velocity controller P gain', u:'', r:'0.1 - 2' },
        PSC_VELZ_D:       { d:'Vertical velocity controller D gain', u:'', r:'0 - 1' },
        PSC_VELZ_I:       { d:'Vertical velocity controller I gain', u:'', r:'0 - 1' },
        PSC_VELZ_IMAX:    { d:'Vertical velocity I-term maximum', u:'', r:'0 - 1000' },
        PSC_VELZ_P:       { d:'Vertical velocity controller P gain', u:'', r:'0.1 - 1' },

        // ── WPNAV extended ─────────────────────────────────────────────────────
        WPNAV_ACCEL_C:    { d:'Waypoint cornering acceleration', u:'cm/s/s', r:'10 - 500' },
        WPNAV_ACCEL_Z:    { d:'Waypoint vertical acceleration', u:'cm/s/s', r:'10 - 500' },
        WPNAV_JERK:       { d:'Waypoint jerk limit', u:'m/s/s/s', r:'1 - 20' },
        WPNAV_RFND_USE:   { d:'Use rangefinder for terrain following', u:'', r:'0:Disabled,1:Enabled' },
        WPNAV_TER_FOLLOW: { d:'Follow terrain during waypoint missions', u:'', r:'0:Disabled,1:Enabled' },

        // ── RTL extended ───────────────────────────────────────────────────────
        RTL_ALT:          { d:'RTL return altitude (cm)', u:'cm', r:'200 - 30000' },
        RTL_ALT_FINAL:    { d:'RTL final altitude before disarm (cm)', u:'cm', r:'0 - 1000' },
        RTL_CLIMB_MIN:    { d:'RTL minimum climb before return (cm)', u:'cm', r:'0 - 3000' },
        RTL_CONE_SLOPE:   { d:'RTL cone slope for altitude limiting', u:'', r:'0 - 10' },
        RTL_LOIT_TIME:    { d:'RTL loiter time at destination', u:'ms', r:'0 - 60000' },
        RTL_SPEED:        { d:'RTL return speed (cm/s; 0 = use WPNAV_SPEED)', u:'cm/s', r:'0 - 2000' },

        // ── CIRCLE ─────────────────────────────────────────────────────────────
        CIRCLE_CONTROL:   { d:'Circle mode enable stick control', u:'', r:'0:Disabled,1:Enabled' },
        CIRCLE_OPTIONS:   { d:'Circle mode options bitmask', u:'', r:'' },
        CIRCLE_RADIUS:    { d:'Circle mode radius', u:'cm', r:'0 - 10000' },
        CIRCLE_RATE:      { d:'Circle mode turn rate', u:'deg/s', r:'-90 - 90' },

        // ── AUTOTUNE extended ──────────────────────────────────────────────────
        AUTOTUNE_OPTIONS: { d:'Autotune options bitmask', u:'', r:'' },

        // ── FLOW (Optical flow) ────────────────────────────────────────────────
        FLOW_ENABLE:      { d:'Enable optical flow sensor', u:'', r:'0:Disabled,1:Enabled' },
        FLOW_FXSCALER:    { d:'X-axis flow scale factor correction', u:'', r:'-200 - 200' },
        FLOW_FYSCALER:    { d:'Y-axis flow scale factor correction', u:'', r:'-200 - 200' },
        FLOW_ORIENT_YAW:  { d:'Flow sensor yaw orientation', u:'cdeg', r:'-17999 - 17999' },
        FLOW_POS_X:       { d:'Flow sensor X position offset from CG', u:'m', r:'-5 - 5' },
        FLOW_POS_Y:       { d:'Flow sensor Y position offset from CG', u:'m', r:'-5 - 5' },
        FLOW_POS_Z:       { d:'Flow sensor Z position offset from CG', u:'m', r:'-5 - 5' },
        FLOW_TYPE:        { d:'Optical flow sensor type', u:'', r:'0:None,1:PX4Flow,2:Pixart,3:Bebop,4:CXOF,5:MAVLink,6:UAVCAN,7:MSP' },

        // ── SR stream rates ────────────────────────────────────────────────────
        SR0_ADSB:         { d:'MAVLink stream rate: ADSB_VEHICLE', u:'Hz', r:'0 - 50' },
        SR0_EXT_STAT:     { d:'MAVLink stream rate: extended status', u:'Hz', r:'0 - 10' },
        SR0_EXTRA1:       { d:'MAVLink stream rate: attitude/EKF', u:'Hz', r:'0 - 50' },
        SR0_EXTRA2:       { d:'MAVLink stream rate: VFR_HUD', u:'Hz', r:'0 - 50' },
        SR0_EXTRA3:       { d:'MAVLink stream rate: AHRS/system', u:'Hz', r:'0 - 50' },
        SR0_PARAMS:       { d:'MAVLink stream rate: PARAM_VALUE', u:'Hz', r:'0 - 50' },
        SR0_POSITION:     { d:'MAVLink stream rate: position/GPS', u:'Hz', r:'0 - 50' },
        SR0_RAW_CTRL:     { d:'MAVLink stream rate: raw controller', u:'Hz', r:'0 - 50' },
        SR0_RAW_SENS:     { d:'MAVLink stream rate: raw sensors', u:'Hz', r:'0 - 50' },
        SR0_RC_CHAN:       { d:'MAVLink stream rate: RC channels', u:'Hz', r:'0 - 50' },
        SR1_ADSB:         { d:'MAVLink 1 stream rate: ADSB', u:'Hz', r:'0 - 50' },
        SR1_EXT_STAT:     { d:'MAVLink 1 stream rate: extended status', u:'Hz', r:'0 - 10' },
        SR1_EXTRA1:       { d:'MAVLink 1 stream rate: attitude/EKF', u:'Hz', r:'0 - 50' },
        SR1_EXTRA2:       { d:'MAVLink 1 stream rate: VFR_HUD', u:'Hz', r:'0 - 50' },
        SR1_EXTRA3:       { d:'MAVLink 1 stream rate: AHRS/system', u:'Hz', r:'0 - 50' },
        SR1_PARAMS:       { d:'MAVLink 1 stream rate: PARAM_VALUE', u:'Hz', r:'0 - 50' },
        SR1_POSITION:     { d:'MAVLink 1 stream rate: position/GPS', u:'Hz', r:'0 - 50' },
        SR1_RAW_CTRL:     { d:'MAVLink 1 stream rate: raw controller', u:'Hz', r:'0 - 50' },
        SR1_RAW_SENS:     { d:'MAVLink 1 stream rate: raw sensors', u:'Hz', r:'0 - 50' },
        SR1_RC_CHAN:       { d:'MAVLink 1 stream rate: RC channels', u:'Hz', r:'0 - 50' },

        // ── MNT (Camera mount) ────────────────────────────────────────────────
        MNT1_DEFLT_MODE:  { d:'Mount 1 default mode at boot', u:'', r:'0:Retract,1:Neutral,2:MavLink,3:RC,4:GPS' },
        MNT1_LEAD_PTCH:   { d:'Mount 1 pitch lead angle (vibration filter)', u:'deg', r:'-90 - 90' },
        MNT1_LEAD_RLL:    { d:'Mount 1 roll lead angle', u:'deg', r:'-90 - 90' },
        MNT1_PITCH_MAX:   { d:'Mount 1 maximum pitch angle', u:'cdeg', r:'-18000 - 18000' },
        MNT1_PITCH_MIN:   { d:'Mount 1 minimum pitch angle', u:'cdeg', r:'-18000 - 18000' },
        MNT1_ROLL_MAX:    { d:'Mount 1 maximum roll angle', u:'cdeg', r:'-18000 - 18000' },
        MNT1_ROLL_MIN:    { d:'Mount 1 minimum roll angle', u:'cdeg', r:'-18000 - 18000' },
        MNT1_TYPE:        { d:'Mount 1 type', u:'', r:'0:None,1:Servo,2:3DR Solo,3:Alexmos,4:SToRM32MAVLink,5:SToRM32Serial' },
        MNT1_YAW_MAX:     { d:'Mount 1 maximum yaw angle', u:'cdeg', r:'-18000 - 18000' },
        MNT1_YAW_MIN:     { d:'Mount 1 minimum yaw angle', u:'cdeg', r:'-18000 - 18000' },

        // ── OSD ───────────────────────────────────────────────────────────────
        OSD_TYPE:         { d:'OSD type', u:'', r:'0:None,1:MAX7456,2:SITL,3:MSP,4:TXONLY' },
        OSD_OPTIONS:      { d:'OSD options bitmask', u:'', r:'1:UseDecimalPack,2:InvertedWindArrow,4:SetBrightnessWithRCin9' },

        // ── BATT (Battery monitors 1–9) ───────────────────────────────────────
        BATT_AMP_OFFSET:  { d:'Battery 1 current sensor offset', u:'A', r:'-10 - 10' },
        BATT_AMP_PERVLT:  { d:'Battery 1 amps per volt scaling', u:'A/V', r:'0 - 100' },
        BATT_ARM_MAH:     { d:'Battery 1 capacity required to arm', u:'mAh', r:'0 - 10000' },
        BATT_ARM_VOLT:    { d:'Battery 1 minimum voltage to arm', u:'V', r:'0 - 25' },
        BATT_CURR_PIN:    { d:'Battery 1 current sensing pin', u:'', r:'-1:Disabled,2:Pixhawk,13:Pixhawk2,14:PixRacerR1,16:Pixhawk4,101:Pixhawk UAVCAN' },
        BATT_FS_CRT_ACT:  { d:'Battery 1 critical failsafe action', u:'', r:'0:None,1:Land,2:RTL,3:SmartRTL,4:SmartRTLOrLand,5:Terminate' },
        BATT_FS_LOW_ACT:  { d:'Battery 1 low failsafe action', u:'', r:'0:None,1:Land,2:RTL,3:SmartRTL,4:SmartRTLOrLand,5:Terminate' },
        BATT_FS_VOLTSRC:  { d:'Battery 1 failsafe voltage source', u:'', r:'0:Raw,1:SagCompensated' },
        BATT_LOW_MAH:     { d:'Battery 1 low mAh threshold', u:'mAh', r:'0 - 50000' },
        BATT_LOW_TIMER:   { d:'Battery 1 low voltage timeout', u:'s', r:'1 - 120' },
        BATT_SERIAL_NUM:  { d:'Battery 1 serial number (UAVCAN)', u:'', r:'0 - 2147483647' },
        BATT_VOLT_MULT:   { d:'Battery 1 voltage multiplier', u:'', r:'0 - 100' },
        BATT_VOLT_PIN:    { d:'Battery 1 voltage sensing pin', u:'', r:'-1:Disabled,2:Pixhawk,13:Pixhawk2,14:PixRacerR1,16:Pixhawk4' },
        BATT2_MONITOR:    { d:'Battery 2 monitoring type', u:'', r:'0:Disabled,3:AnalogVoltage,4:AnalogVolt+Curr,5:Solo,7:SMBus,9:UAVCAN,10:Sum' },
        BATT2_CAPACITY:   { d:'Battery 2 capacity', u:'mAh', r:'0 - 100000' },
        BATT2_CRT_VOLT:   { d:'Battery 2 critical voltage', u:'V', r:'0 - 25' },
        BATT2_LOW_VOLT:   { d:'Battery 2 low voltage', u:'V', r:'0 - 25' },
        BATT2_VOLT_MULT:  { d:'Battery 2 voltage multiplier', u:'', r:'0 - 100' },
        BATT2_AMP_PERVLT: { d:'Battery 2 amps per volt scaling', u:'A/V', r:'0 - 100' },

        // ── DSTL (Deadstick landing) ───────────────────────────────────────────
        DSTL_ALT_HLD:     { d:'Deadstick altitude hold', u:'m', r:'1 - 30' },
        DSTL_CLIMB_DIST:  { d:'Deadstick loiter-to-glide distance', u:'m', r:'0.5 - 100' },
        DSTL_DIR_RTL:     { d:'Use RTL direction for glide', u:'', r:'0:Disabled,1:RTL_dir_used' },
        DSTL_DISABLE:     { d:'Disable deadstick support', u:'', r:'0:Enabled,1:Disabled' },
        DSTL_F_ALT:       { d:'Deadstick final approach altitude', u:'m', r:'1 - 200' },
        DSTL_F_DIST:      { d:'Deadstick final approach distance', u:'m', r:'0.5 - 100' },
        DSTL_GLIDE_SLOPE: { d:'Deadstick glide slope angle', u:'deg', r:'1 - 80' },
        DSTL_LOITER_ALT:  { d:'Deadstick loiter altitude', u:'m', r:'1 - 200' },
        DSTL_LOITER_RAD:  { d:'Deadstick loiter radius', u:'m', r:'25 - 1000' },

        // ── ZIGZAG ─────────────────────────────────────────────────────────────
        ZIGZAG_AUTO_ENABLE:{ d:'Zigzag auto-enable spray', u:'', r:'0:Disabled,1:Enabled' },
        ZIGZAG_DIRECTION:  { d:'Zigzag initial direction', u:'', r:'0:Forward,1:Right,2:Backward,3:Left' },
        ZIGZAG_LINE_NUM:   { d:'Zigzag number of lines', u:'', r:'0 - 255' },
        ZIGZAG_SIDE_DIST:  { d:'Zigzag side distance', u:'m', r:'0.1 - 100' },
        ZIGZAG_SPEED_DN:   { d:'Zigzag descent speed', u:'cm/s', r:'10 - 200' },

        // ── SPRAYER ────────────────────────────────────────────────────────────
        SPRAY_ENABLE:     { d:'Enable sprayer', u:'', r:'0:Disabled,1:Enabled' },
        SPRAY_PUMP_RATE:  { d:'Pump speed scalar (turns per m/s)', u:'', r:'0 - 100' },
        SPRAY_SPEED_MIN:  { d:'Minimum speed to spin pump', u:'cm/s', r:'0 - 600' },
        SPRAY_SPINNER:    { d:'Spinner spin time before moving', u:'s', r:'0 - 60' },

        // ── SYSID / GCS ────────────────────────────────────────────────────────
        SYSID_ENFORCE:    { d:'Enforce system ID checks', u:'', r:'0:Disabled,1:Enabled' },
        SYSID_MYGCS:      { d:'My GCS system ID', u:'', r:'1 - 255' },
        SYSID_SW_MREV:    { d:'Software version minor revision', u:'', r:'' },
        SYSID_SW_TYPE:    { d:'Software type identifier', u:'', r:'' },
        SYSID_THISMAV:    { d:'MAVLink system ID of this autopilot', u:'', r:'1 - 255' },

        // ── FRSKY / VFRHUD stream ─────────────────────────────────────────────
        FRSKY_OPTIONS:    { d:'FrSky telemetry options', u:'', r:'' },

        // ── CRASH CHECK ───────────────────────────────────────────────────────
        CRASH_CHECK_ANGL: { d:'Crash angle threshold', u:'deg', r:'15 - 45' },
        CRASH_CHECK_DECC: { d:'Crash deceleration threshold', u:'m/s/s', r:'3 - 10' },

        // ── DISARM DELAY ──────────────────────────────────────────────────────
        DISARM_DELAY:     { d:'Auto-disarm delay after landing', u:'s', r:'0 - 127' },

        // ── GND_EFFECT ────────────────────────────────────────────────────────
        GND_EFFECT_COMP:  { d:'Ground effect compensation enable', u:'', r:'0:Disabled,1:Enabled' },

        // ── VIBE (Vibration failsafe) ─────────────────────────────────────────
        VIBE_FREQ:        { d:'Vibration frequency threshold', u:'Hz', r:'0 - 100' },

        COMPASS_DEC:         { d:'Magnetic declination angle (positive East)', u:'rad', r:'-3.142 - 3.142' },
        COMPASS_SCALE:       { d:'Compass 1 scale factor', u:'', r:'0 - 10' },
        COMPASS_SCALE2:      { d:'Compass 2 scale factor', u:'', r:'0 - 10' },
        COMPASS_SCALE3:      { d:'Compass 3 scale factor', u:'', r:'0 - 10' },
        COMPASS_DISBLMSK:    { d:'Compass disable bitmask (disables specific compasses)', u:'', r:'0:None,1:Compass1,2:Compass2,4:Compass3' },
        COMPASS_OFFS_MAX:    { d:'Maximum allowed compass offset (calibration validity limit)', u:'mGauss', r:'0 - 3000' },
        COMPASS_TYPEMASK:    { d:'Compass type mask (bitmask to exclude compass types)', u:'', r:'' },
        COMPASS_FLTR_RNG:    { d:'Compass heading filter range (degrees from EKF)', u:'deg', r:'0 - 180' },
        COMPASS_AUTO_ROT:    { d:'Automatically attempt to rotate compass', u:'', r:'0:Disabled,1:Enabled,2:Fix only' },
        // Compass 1 offsets
        COMPASS_OFS_X:       { d:'Compass 1 X-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        COMPASS_OFS_Y:       { d:'Compass 1 Y-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        COMPASS_OFS_Z:       { d:'Compass 1 Z-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        // Compass 2 offsets
        COMPASS_OFS2_X:      { d:'Compass 2 X-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        COMPASS_OFS2_Y:      { d:'Compass 2 Y-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        COMPASS_OFS2_Z:      { d:'Compass 2 Z-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        // Compass 3 offsets
        COMPASS_OFS3_X:      { d:'Compass 3 X-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        COMPASS_OFS3_Y:      { d:'Compass 3 Y-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        COMPASS_OFS3_Z:      { d:'Compass 3 Z-axis hard iron offset', u:'mGauss', r:'-400 - 400' },
        // Compass 1 diagonal (soft iron) offsets
        COMPASS_ODI_X:       { d:'Compass 1 soft iron X-axis diagonal compensation', u:'', r:'-1 - 1' },
        COMPASS_ODI_Y:       { d:'Compass 1 soft iron Y-axis diagonal compensation', u:'', r:'-1 - 1' },
        COMPASS_ODI_Z:       { d:'Compass 1 soft iron Z-axis diagonal compensation', u:'', r:'-1 - 1' },
        // Compass 2 diagonal (soft iron) offsets
        COMPASS_ODI2_X:      { d:'Compass 2 soft iron X-axis diagonal compensation', u:'', r:'-1 - 1' },
        COMPASS_ODI2_Y:      { d:'Compass 2 soft iron Y-axis diagonal compensation', u:'', r:'-1 - 1' },
        COMPASS_ODI2_Z:      { d:'Compass 2 soft iron Z-axis diagonal compensation', u:'', r:'-1 - 1' },
        // Compass 3 diagonal (soft iron) offsets
        COMPASS_ODI3_X:      { d:'Compass 3 soft iron X-axis diagonal compensation', u:'', r:'-1 - 1' },
        COMPASS_ODI3_Y:      { d:'Compass 3 soft iron Y-axis diagonal compensation', u:'', r:'-1 - 1' },
        COMPASS_ODI3_Z:      { d:'Compass 3 soft iron Z-axis diagonal compensation', u:'', r:'-1 - 1' },
        // Compass 1 off-diagonal (soft iron) offsets
        COMPASS_OFD_X:       { d:'Compass 1 soft iron off-diagonal X compensation', u:'', r:'-1 - 1' },
        COMPASS_OFD_Y:       { d:'Compass 1 soft iron off-diagonal Y compensation', u:'', r:'-1 - 1' },
        COMPASS_OFD_Z:       { d:'Compass 1 soft iron off-diagonal Z compensation', u:'', r:'-1 - 1' },
        // Compass 2 off-diagonal
        COMPASS_OFD2_X:      { d:'Compass 2 soft iron off-diagonal X compensation', u:'', r:'-1 - 1' },
        COMPASS_OFD2_Y:      { d:'Compass 2 soft iron off-diagonal Y compensation', u:'', r:'-1 - 1' },
        COMPASS_OFD2_Z:      { d:'Compass 2 soft iron off-diagonal Z compensation', u:'', r:'-1 - 1' },
        // Compass 3 off-diagonal
        COMPASS_OFD3_X:      { d:'Compass 3 soft iron off-diagonal X compensation', u:'', r:'-1 - 1' },
        COMPASS_OFD3_Y:      { d:'Compass 3 soft iron off-diagonal Y compensation', u:'', r:'-1 - 1' },
        COMPASS_OFD3_Z:      { d:'Compass 3 soft iron off-diagonal Z compensation', u:'', r:'-1 - 1' },
        // Motor compensation (throttle/current-based interference)
        COMPASS_MOT_X:       { d:'Compass 1 motor interference X-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT_Y:       { d:'Compass 1 motor interference Y-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT_Z:       { d:'Compass 1 motor interference Z-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT2_X:      { d:'Compass 2 motor interference X-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT2_Y:      { d:'Compass 2 motor interference Y-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT2_Z:      { d:'Compass 2 motor interference Z-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT3_X:      { d:'Compass 3 motor interference X-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT3_Y:      { d:'Compass 3 motor interference Y-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        COMPASS_MOT3_Z:      { d:'Compass 3 motor interference Z-axis compensation', u:'mGauss/A', r:'-1000 - 1000' },
        // Position offsets from CG
        COMPASS_POS_X:       { d:'Compass 1 X position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS_Y:       { d:'Compass 1 Y position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS_Z:       { d:'Compass 1 Z position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS2_X:      { d:'Compass 2 X position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS2_Y:      { d:'Compass 2 Y position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS2_Z:      { d:'Compass 2 Z position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS3_X:      { d:'Compass 3 X position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS3_Y:      { d:'Compass 3 Y position offset from CG', u:'m', r:'-5 - 5' },
        COMPASS_POS3_Z:      { d:'Compass 3 Z position offset from CG', u:'m', r:'-5 - 5' },
        // Device IDs (read-only, populated by driver)
        COMPASS_DEV_ID:      { d:'Compass 1 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID2:     { d:'Compass 2 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID3:     { d:'Compass 3 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID4:     { d:'Compass 4 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID5:     { d:'Compass 5 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID6:     { d:'Compass 6 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID7:     { d:'Compass 7 device ID (auto-detected)', u:'', r:'' },
        COMPASS_DEV_ID8:     { d:'Compass 8 device ID (auto-detected)', u:'', r:'' },
        // Priority ordering
        COMPASS_PRIO1_ID:    { d:'Compass priority 1 device ID', u:'', r:'' },
        COMPASS_PRIO2_ID:    { d:'Compass priority 2 device ID', u:'', r:'' },
        COMPASS_PRIO3_ID:    { d:'Compass priority 3 device ID', u:'', r:'' },
        // Calibration fitness
        COMPASS_CAL_FIT:     { d:'Compass calibration fitness target (lower = tighter)', u:'', r:'4 - 32' },

        // ── SITL / SIM_ parameters ─────────────────────────────────────────────
        SIM_ACC1_BIAS_X:  { d:'SITL accelerometer 1 X axis bias', u:'m/s/s', r:'' },
        SIM_ACC1_BIAS_Y:  { d:'SITL accelerometer 1 Y axis bias', u:'m/s/s', r:'' },
        SIM_ACC1_BIAS_Z:  { d:'SITL accelerometer 1 Z axis bias', u:'m/s/s', r:'' },
        SIM_ACC1_RND:     { d:'SITL accelerometer 1 noise (random)', u:'m/s/s', r:'0 - 5' },
        SIM_ACC2_BIAS_X:  { d:'SITL accelerometer 2 X axis bias', u:'m/s/s', r:'' },
        SIM_ACC2_BIAS_Y:  { d:'SITL accelerometer 2 Y axis bias', u:'m/s/s', r:'' },
        SIM_ACC2_BIAS_Z:  { d:'SITL accelerometer 2 Z axis bias', u:'m/s/s', r:'' },
        SIM_ACC2_RND:     { d:'SITL accelerometer 2 noise (random)', u:'m/s/s', r:'0 - 5' },
        SIM_ACC3_BIAS_X:  { d:'SITL accelerometer 3 X axis bias', u:'m/s/s', r:'' },
        SIM_ACC3_BIAS_Y:  { d:'SITL accelerometer 3 Y axis bias', u:'m/s/s', r:'' },
        SIM_ACC3_BIAS_Z:  { d:'SITL accelerometer 3 Z axis bias', u:'m/s/s', r:'' },
        SIM_ACC3_RND:     { d:'SITL accelerometer 3 noise (random)', u:'m/s/s', r:'0 - 5' },
        SIM_ACCEL_FAIL:   { d:'SITL accelerometer failure mask (bitmask: 1=IMU1,2=IMU2,4=IMU3)', u:'', r:'0:None,1:IMU1,2:IMU2,3:IMU1+2,4:IMU3,7:All' },
        SIM_ALT_RADALT:   { d:'SITL altitude at which rangefinder returns valid data', u:'m', r:'0 - 100' },
        SIM_ARSPD_FAIL:   { d:'SITL airspeed sensor failure', u:'', r:'0:Disabled,1:Enabled' },
        SIM_ARSPD_FAILP:  { d:'SITL airspeed sensor failure pressure', u:'Pa', r:'' },
        SIM_ARSPD_OFS:    { d:'SITL airspeed sensor offset', u:'Pa', r:'' },
        SIM_ARSPD_RND:    { d:'SITL airspeed sensor random noise', u:'m/s', r:'0 - 10' },
        SIM_BAR2_DISABLE: { d:'SITL disable barometer 2', u:'', r:'0:Enabled,1:Disabled' },
        SIM_BAR2_DRIFT:   { d:'SITL barometer 2 altitude drift rate', u:'m/s', r:'' },
        SIM_BAR2_GLITCH:  { d:'SITL barometer 2 glitch altitude', u:'m', r:'' },
        SIM_BAR2_RND:     { d:'SITL barometer 2 noise (RMS)', u:'Pa', r:'0 - 100' },
        SIM_BAR3_DISABLE: { d:'SITL disable barometer 3', u:'', r:'0:Enabled,1:Disabled' },
        SIM_BAR3_DRIFT:   { d:'SITL barometer 3 altitude drift rate', u:'m/s', r:'' },
        SIM_BAR3_RND:     { d:'SITL barometer 3 noise (RMS)', u:'Pa', r:'0 - 100' },
        SIM_BARO_DISABLE: { d:'SITL disable primary barometer', u:'', r:'0:Enabled,1:Disabled' },
        SIM_BARO_DRIFT:   { d:'SITL barometer altitude drift rate', u:'m/s', r:'' },
        SIM_BARO_GLITCH:  { d:'SITL barometer glitch altitude', u:'m', r:'' },
        SIM_BARO_RND:     { d:'SITL barometer noise (RMS)', u:'Pa', r:'0 - 100' },
        SIM_BATT_VOLTAGE: { d:'SITL battery voltage', u:'V', r:'0 - 100' },
        SIM_DRIFT_SPEED:  { d:'SITL gyro drift rate', u:'deg/s/s', r:'0 - 10' },
        SIM_DRIFT_TIME:   { d:'SITL gyro drift time', u:'s', r:'0 - 100' },
        SIM_EFI_TYPE:     { d:'SITL EFI type', u:'', r:'0:None,1:MegaSquirt' },
        SIM_ENGINE_FAIL:  { d:'SITL engine failure mask', u:'', r:'' },
        SIM_ENGINE_MUL:   { d:'SITL engine failure throttle multiplier', u:'', r:'0 - 1' },
        SIM_FLOW_DELAY:   { d:'SITL optical flow measurement delay', u:'ms', r:'0 - 200' },
        SIM_FLOW_ENABLE:  { d:'SITL optical flow enable', u:'', r:'0:Disabled,1:Enabled' },
        SIM_FLOW_POS_X:   { d:'SITL optical flow sensor X position from CG', u:'m', r:'-5 - 5' },
        SIM_FLOW_POS_Y:   { d:'SITL optical flow sensor Y position from CG', u:'m', r:'-5 - 5' },
        SIM_FLOW_POS_Z:   { d:'SITL optical flow sensor Z position from CG', u:'m', r:'-5 - 5' },
        SIM_FLOW_RATE:    { d:'SITL optical flow measurement rate', u:'Hz', r:'1 - 100' },
        SIM_FLOW_RND:     { d:'SITL optical flow noise', u:'rad/s', r:'0 - 0.5' },
        SIM_FLOW_TYPE:    { d:'SITL optical flow sensor type', u:'', r:'0:None,1:PX4Flow,2:Pixart' },
        SIM_FLTMODE_CH:   { d:'SITL flight mode RC channel', u:'', r:'0 - 16' },
        SIM_ODOM_ENABLE:  { d:'SITL odometry enable', u:'', r:'0:Disabled,1:Enabled' },
        SIM_RATE_HZ:      { d:'SITL simulation rate', u:'Hz', r:'1 - 1000' },
        SIM_RC_FAIL:      { d:'SITL RC failure mode', u:'', r:'0:None,1:NoPulses,2:LowThrottle' },
        SIM_SERVO_SPEED:  { d:'SITL servo speed', u:'deg/s', r:'' },
        SIM_SHOVE_TIME:   { d:'SITL shove duration', u:'ms', r:'0 - 1000' },
        SIM_SHOVE_X:      { d:'SITL shove acceleration X axis', u:'m/s/s', r:'-100 - 100' },
        SIM_SHOVE_Y:      { d:'SITL shove acceleration Y axis', u:'m/s/s', r:'-100 - 100' },
        SIM_SHOVE_Z:      { d:'SITL shove acceleration Z axis', u:'m/s/s', r:'-100 - 100' },
        SIM_SPEEDUP:      { d:'SITL simulation speedup factor', u:'', r:'1 - 100' },
        SIM_TERRAIN:      { d:'SITL enable terrain simulation', u:'', r:'0:Disabled,1:Enabled' },
        SIM_VICON_FAIL:   { d:'SITL VICON failure mode', u:'', r:'0:None,1:Fail' },
        SIM_VICON_POS_X:  { d:'SITL VICON sensor X position from CG', u:'m', r:'-5 - 5' },
        SIM_VICON_POS_Y:  { d:'SITL VICON sensor Y position from CG', u:'m', r:'-5 - 5' },
        SIM_VICON_POS_Z:  { d:'SITL VICON sensor Z position from CG', u:'m', r:'-5 - 5' },
        SIM_VICON_TMASK:  { d:'SITL VICON type mask', u:'', r:'' },
        SIM_VICON_VROT:   { d:'SITL VICON rotation velocity noise', u:'rad/s', r:'0 - 1' },
        SIM_VIB_FREQ_X:   { d:'SITL vibration frequency X axis', u:'Hz', r:'0 - 1000' },
        SIM_VIB_FREQ_Y:   { d:'SITL vibration frequency Y axis', u:'Hz', r:'0 - 1000' },
        SIM_VIB_FREQ_Z:   { d:'SITL vibration frequency Z axis', u:'Hz', r:'0 - 1000' },
        SIM_VIB_MOT_MAX:  { d:'SITL motor vibration amplitude at full throttle', u:'m/s/s', r:'0 - 100' },
        SIM_WIND_DIR:     { d:'SITL wind direction (from North)', u:'deg', r:'0 - 360' },
        SIM_WIND_SPD:     { d:'SITL wind speed', u:'m/s', r:'0 - 100' },
        SIM_WIND_TURB:    { d:'SITL wind turbulence', u:'', r:'0 - 1' },

        // GPS instance sub-parameters
        SIM_GPS_DISABLE:  { d:'SITL disable primary GPS', u:'', r:'0:Enabled,1:Disabled' },
        SIM_GPS_GLITCH_X: { d:'SITL GPS position glitch X (North)', u:'m', r:'' },
        SIM_GPS_GLITCH_Y: { d:'SITL GPS position glitch Y (East)', u:'m', r:'' },
        SIM_GPS_GLITCH_Z: { d:'SITL GPS position glitch Z (Down)', u:'m', r:'' },
        SIM_GPS_HZ:       { d:'SITL GPS update rate', u:'Hz', r:'1 - 50' },
        SIM_GPS_LAG_MS:   { d:'SITL GPS lag', u:'ms', r:'0 - 1000' },
        SIM_GPS_LOCKTIME: { d:'SITL GPS time to first lock', u:'s', r:'0 - 30' },
        SIM_GPS_NOISE:    { d:'SITL GPS position noise (RMS)', u:'m', r:'0 - 10' },
        SIM_GPS_NUMSATS:  { d:'SITL GPS number of visible satellites', u:'', r:'0 - 50' },
        SIM_GPS_OPTIONS:  { d:'SITL GPS options bitmask', u:'', r:'' },
        SIM_GPS_TYPE:     { d:'SITL GPS type', u:'', r:'0:None,1:UBLOX,5:NMEA,6:SiRF,7:HIL,9:UAVCAN' },
        SIM_GPS_VERR_X:   { d:'SITL GPS velocity error X (North)', u:'m/s', r:'' },
        SIM_GPS_VERR_Y:   { d:'SITL GPS velocity error Y (East)', u:'m/s', r:'' },
        SIM_GPS_VERR_Z:   { d:'SITL GPS velocity error Z (Down)', u:'m/s', r:'' },

        // SIM_GRPE (gripper)
        SIM_GRPE_ENABLE:  { d:'SITL gripper EPM enable', u:'', r:'0:Disabled,1:Enabled' },
        SIM_GRPE_PIN:     { d:'SITL gripper EPM pin number', u:'', r:'-1:Disabled,0-99:Pin' },
        // SIM_GRPS (servo gripper)
        SIM_GRPS_ENABLE:  { d:'SITL servo gripper enable', u:'', r:'0:Disabled,1:Enabled' },
        SIM_GRPS_GRAB:    { d:'SITL servo gripper grab PWM value', u:'PWM', r:'1000 - 2000' },
        SIM_GRPS_PIN:     { d:'SITL servo gripper output pin', u:'', r:'-1:Disabled,0-99:Pin' },
        SIM_GRPS_RELEASE: { d:'SITL servo gripper release PWM value', u:'PWM', r:'1000 - 2000' },
        SIM_GRPS_REVERSE: { d:'SITL servo gripper reverse direction', u:'', r:'0:Normal,1:Reversed' },
    };

    // ── SITL GPS instance sub-parameter lookup table ────────────────────────────
    // Maps suffix → {d, u, r} for SIM_GPS1_, SIM_GPS2_, etc.
    const SIM_GPS_SUFFIXES = {
        DISABLE:  { d:'SITL disable this GPS instance', u:'', r:'0:Enabled,1:Disabled' },
        GLITCH_X: { d:'SITL GPS glitch X axis offset (North)', u:'m', r:'' },
        GLITCH_Y: { d:'SITL GPS glitch Y axis offset (East)', u:'m', r:'' },
        GLITCH_Z: { d:'SITL GPS glitch Z axis offset (Down)', u:'m', r:'' },
        HZ:       { d:'SITL GPS update rate', u:'Hz', r:'1 - 50' },
        LAG_MS:   { d:'SITL GPS lag time', u:'ms', r:'0 - 1000' },
        LOCKTIME: { d:'SITL GPS lock acquisition time', u:'s', r:'0 - 30' },
        NOISE:    { d:'SITL GPS horizontal position noise (RMS)', u:'m', r:'0 - 10' },
        NUMSATS:  { d:'SITL GPS number of simulated satellites', u:'', r:'0 - 50' },
        OPTIONS:  { d:'SITL GPS options bitmask', u:'', r:'' },
        TYPE:     { d:'SITL GPS receiver type', u:'', r:'0:None,1:UBLOX,5:NMEA,6:SiRF,7:HIL,9:UAVCAN' },
        VERR_X:   { d:'SITL GPS velocity error North', u:'m/s', r:'' },
        VERR_Y:   { d:'SITL GPS velocity error East', u:'m/s', r:'' },
        VERR_Z:   { d:'SITL GPS velocity error Down', u:'m/s', r:'' },
    };

    // Generic RC channel metadata lookup (RC1_MIN → RC_MIN pattern)
// Parses a legacy r-string like "0:Disabled,1:RTL,2:Land" into an options array.
// Returns null if r does not look like an options list.
function parseOptionsFromRange(r) {
    if (!r) return null;
    // Must contain at least one  "digit:word" pair separated by commas
    if (!/[-\d.]+:[^,]+/.test(r)) return null;
    // Must not look like a plain numeric range like "0 - 100"
    if (/^-?[\d.]+ - -?[\d.]+$/.test(r.trim())) return null;
    const parts = r.split(',');
    const opts = [];
    for (const p of parts) {
        const idx = p.indexOf(':');
        if (idx < 0) return null; // malformed
        opts.push({ code: p.slice(0, idx).trim(), label: p.slice(idx + 1).trim() });
    }
    return opts.length ? opts : null;
}

function getMeta(name) {
    if (externalMeta[name]) return externalMeta[name];
    const m = META[name];
    if (m) {
        // Upgrade legacy META entry: convert r-string options into options array
        if (!m._upgraded) {
            const opts = parseOptionsFromRange(m.r);
            if (opts) { m.options = opts; }
            m._upgraded = true;
        }
        return m;
    }
    if (/^INS\d+_ACC/.test(name))  return { d:'INS accelerometer parameter', u:'', r:'' };
    if (/^INS\d+_GYR/.test(name))  return { d:'INS gyro parameter', u:'', r:'' };
    if (/^INS_GYR\d+/.test(name))  return { d:'INS gyro calibration', u:'', r:'' };
    if (/^BARO\d+_WCF/.test(name)) return { d:'Barometer wind correction coefficient', u:'', r:'' };
    if (/^GPS\d+_/.test(name))     return { d:'GPS instance parameter', u:'', r:'' };
    if (/^ATC_/.test(name))        return { d:'Attitude controller parameter', u:'', r:'' };
    if (/^PSC_/.test(name))        return { d:'Position controller parameter', u:'', r:'' };
    if (/^WPNAV_/.test(name))      return { d:'Waypoint navigation parameter', u:'', r:'' };
    if (/^LOG_/.test(name))        return { d:'Logging parameter', u:'', r:'' };
    if (/^NTF_/.test(name))        return { d:'Notification parameter', u:'', r:'' };
    if (/^PRX\d*_/.test(name))     return { d:'Proximity sensor parameter', u:'', r:'' };
    if (/^FILT\d+_/.test(name))    return { d:'Filter instance parameter', u:'', r:'' };
    if (/^NET_/.test(name))        return { d:'Networking parameter', u:'', r:'' };
    if (/^RNGFND\d*_/.test(name))  return { d:'Range finder parameter', u:'', r:'' };
    if (/^TEMP\d*_/.test(name))    return { d:'Temperature sensor parameter', u:'', r:'' };
    if (/^SR\d+_/.test(name))      return { d:'MAVLink telemetry stream rate', u:'Hz', r:'0 - 50' };
    if (/^BATT\d+_/.test(name))    return { d:'Battery monitor parameter', u:'', r:'' };
    if (/^MNT\d*_/.test(name))     return { d:'Camera mount parameter', u:'', r:'' };
    if (/^OSD\d*_/.test(name))     return { d:'OSD layout parameter', u:'', r:'' };
    if (/^CAN_/.test(name))        return { d:'CAN bus parameter', u:'', r:'' };
    if (/^LAND_/.test(name))       return { d:'Landing controller parameter', u:'', r:'' };
    return { d: '', u: '', r: '' };
}
let externalMeta = {};

function loadExternalMeta() {
    // Build a list of candidate URLs to try in order:
    //  1. Electron packaged app: param_metadata.json is in extraResources → resources/
    //     process.resourcesPath is available in both main and renderer in Electron.
    //  2. Dev mode: relative path next to the HTML file.
    const candidates = [];

    // Packaged Electron: resourcesPath points to the resources/ folder inside the exe
    if (typeof process !== 'undefined' && process.resourcesPath) {
        // Convert Windows path to a file:// URL
        const rp = process.resourcesPath.replace(/\\/g, '/');
        candidates.push('file:///' + rp + '/param_metadata.json');
    }

    // Dev / browser fallback: relative fetch
    candidates.push('param_metadata.json');

    function tryNext(urls) {
        if (!urls.length) {
            console.log('[ParamFull] param_metadata.json not found in any location — using built-in META only');
            return Promise.resolve();
        }
        const url = urls[0];
        return fetch(url)
            .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(data => {
                externalMeta = data;
                console.log('[ParamFull] Metadata loaded from', url, '—', Object.keys(data).length, 'entries');
            })
            .catch(err => {
                console.log('[ParamFull] Could not load from', url, '—', err.message, '— trying next…');
                return tryNext(urls.slice(1));
            });
    }

    return tryNext(candidates);
}
    // ── State ─────────────────────────────────────────────────────────────────
    let allParams   = {};
    let dirtyParams = {};
    let isLoading   = false;

    function wsSend(obj) {
        if (!window.ws || window.ws.readyState !== WebSocket.OPEN) {
            console.warn('[ParamFull] WS not open');
            return;
        }

        // ── param_set: single drone or broadcast to all ────────────────────────
        if (obj.type === 'param_set') {
            const activeSysid = window.selectedSysId;
            console.log('[ParamFull] param_set → selectedSysId=' + activeSysid, obj.param_id);
            if (activeSysid === 0 && window.activeSysids && window.activeSysids.length > 0) {
                window.activeSysids.forEach(sysid => {
                    window.ws.send(JSON.stringify({ ...obj, sysid }));
                });
                console.log('[ParamFull] Broadcasted param_set to all drones:', obj);
            } else {
                const sysid = (activeSysid && activeSysid > 0) ? activeSysid : 1;
                window.ws.send(JSON.stringify({ ...obj, sysid }));
            }
            return;
        }

        // ── param_request_list: fetch for selected drone only ─────────────────
        // When "All Drones" is selected, we fetch the first connected drone
        // (the primary) so the panel shows something useful.
        if (obj.type === 'param_request_list') {
            let targetSysid;
            if (window.selectedSysId === 0) {
                // All Drones mode → fetch from primary (first connected)
                targetSysid = (window.activeSysids && window.activeSysids.length > 0)
                    ? window.activeSysids[0]
                    : 1;
                console.log('[ParamFull] "All Drones" selected — fetching params from primary drone sysid=' + targetSysid);
            } else {
                targetSysid = window.selectedSysId > 0 ? window.selectedSysId : 1;
            }
            _currentParamSysid = targetSysid;
            _updateDroneBadge();
            window.ws.send(JSON.stringify({ ...obj, sysid: targetSysid }));
            return;
        }

        // ── all other messages: inject sysid for single target ─────────────────
        const sysid = (window.selectedSysId && window.selectedSysId > 0) ? window.selectedSysId : 1;
        window.ws.send(JSON.stringify({ ...obj, sysid }));
    }

    // ── Track which drone's params are currently displayed ────────────────────
    let _currentParamSysid = null;

    function _updateDroneBadge() {
        const badge = document.getElementById('fpDroneBadge');
        if (!badge) return;
        if (_currentParamSysid && _currentParamSysid > 0) {
            badge.textContent = '📡 Drone ' + _currentParamSysid;
            badge.style.display = 'inline-block';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    }

function handleMessage(data) {
    const t = data.type;
    if (t === 'param_load_start') {
        isLoading = true; dirtyParams = {}; allParams = {};
        setStatus('Loading parameters…'); setProgress(0, 0); showProgressBar(true);
    } else if (t === 'param_load_progress') {
        setProgress(data.received, data.total);
        const b = document.getElementById('fpPBar'); if (b) b.style.width = (data.percent||0)+'%';
    } else if (t === 'param_load_complete') {
        isLoading = false; showProgressBar(false);
        setStatus(data.count + ' parameters loaded (' + data.elapsed_ms + ' ms)'); rebuildTable();
    } else if (t === 'param_value') {
        // Bug #3 fixed: data.name → data.param_id
        const name = data.param_id;
        allParams[name] = { name, value:data.value, type:data.type_id, index:data.index, count:data.count };
        if (!isLoading) { upsertRow(name); setStatus(Object.keys(allParams).length + ' parameters loaded'); }
    } else if (t === 'param_all') {
        allParams = {};
        // Bug #4 fixed: p.name → p.param_id
        (data.params||[]).forEach(p => { allParams[p.param_id] = { name:p.param_id, value:p.value, type:p.type, index:p.index }; });
        isLoading = false; showProgressBar(false);
        setStatus(Object.keys(allParams).length + ' parameters loaded'); rebuildTable();
    } else if (t === 'param_set_sent') {
        // Bug #5 fixed: data.name → data.param_id
        const { toast } = window.SwUtil||{}; if (toast) toast('Set '+data.param_id+' → '+data.value);
        delete dirtyParams[data.param_id]; highlightRow(data.param_id, 'sent');
    } else if (t === 'param_file_saved') {
        const { toast } = window.SwUtil||{}; if (toast) toast(data.message||'Saved to '+data.path);
    } else if (t === 'param_file_loaded') {
        const { toast } = window.SwUtil||{}; if (toast) toast(data.message||data.count+' params loaded');
    } else if (t === 'param_error') {
        const { toast } = window.SwUtil||{}; if (toast) toast('⚠ '+data.message);
    }
}
    function setStatus(t)  { const e=document.getElementById('fpCount'); if(e) e.textContent=t; }
    function setProgress(r,tot) { const e=document.getElementById('fpPTxt'); if(e&&tot>0) e.textContent=r+' / '+tot; }
    function showProgressBar(s) { const e=document.getElementById('fpPWrap'); if(e) e.style.display=s?'flex':'none'; }
    function highlightRow(name,state) {
        const r=document.querySelector('#fpBody tr[data-param="'+CSS.escape(name)+'"]');
        if(r){ r.classList.remove('param-dirty','param-sent'); if(state) r.classList.add('param-'+state); }
    }

    function makeValueCell(p, m) {
        const val = p.value;
        if (m && m.options && m.options.length) {
            // Dropdown / combobox
            let html = '<select class="param-val-select" data-original="'+val+'">';
            let matched = false;
            m.options.forEach(o => {
                const sel = (parseFloat(o.code) === parseFloat(val) || o.code === String(val)) ? ' selected' : '';
                if (sel) matched = true;
                html += '<option value="'+escH(o.code)+'"'+sel+'>'+escH(o.code)+' — '+escH(o.label)+'</option>';
            });
            if (!matched) html += '<option value="'+escH(String(val))+'" selected>'+escH(fmtV(val))+' (custom)</option>';
            html += '</select>';
            return '<td class="fp-v fp-v-sel">'+html+'</td>';
        }
        return '<td class="fp-v"><input class="param-val-input" data-original="'+val+'" value="'+fmtV(val)+'"></td>';
    }

    function makeRangeCell(m) {
        if (!m) return '<td class="fp-r">—</td>';
        if (m.isBitmask && m.bitmask && m.bitmask.length) {
            const bits = m.bitmask.map(b => '<span class="fp-bit"><b>bit'+escH(b.bit)+'</b> '+escH(b.label)+'</span>').join(' ');
            return '<td class="fp-r fp-r-bits">'+bits+'</td>';
        }
        if (m.options && m.options.length) {
            // Already shown in select — just show count
            const preview = m.options.slice(0,3).map(o=>escH(o.code)+':'+escH(o.label)).join(', ');
            const more = m.options.length > 3 ? ' <span class="fp-more">+'+( m.options.length-3)+' more</span>' : '';
            return '<td class="fp-r fp-r-opts">'+preview+more+'</td>';
        }
        if (m.r) {
            const incHtml = m.inc ? ' <span class="fp-inc">step '+escH(m.inc)+'</span>' : '';
            return '<td class="fp-r"><span class="fp-range-badge">'+escH(m.r)+'</span>'+incHtml+'</td>';
        }
        return '<td class="fp-r">—</td>';
    }

    function makeDescCell(m) {
        if (!m || !m.d) return '<td class="fp-d">—</td>';
        let html = '<div class="fp-desc-text">'+escH(m.d)+'</div>';
        if (m.reboot) html += '<span class="fp-reboot-badge">Reboot Required</span>';
        if (m.ut) html += '<span class="fp-unit-text">Unit: '+escH(m.ut)+'</span>';
        return '<td class="fp-d">'+html+'</td>';
    }

    function makeRowHTML(p) {
        const m = getMeta(p.name);
        const unitText = (m && m.u) ? escH(m.u) : '—';
        return '<td class="fp-n"><span class="fp-param-name">'+escH(p.name)+'</span></td>'+
               makeValueCell(p, m)+
               '<td class="fp-u">'+unitText+'</td>'+
               makeRangeCell(m)+
               makeDescCell(m);
    }

function attachRowEvents(row) {
    const name = row.dataset.param;

    // --- Text input (numeric) ---
    const input = row.querySelector('.param-val-input');
    if (input) {
        input.addEventListener('focus', () => input.removeAttribute('readonly'));
        input.addEventListener('input', () => {
            const orig = parseFloat(input.dataset.original), cur = parseFloat(input.value);
            if (!isNaN(cur) && cur !== orig) { dirtyParams[name] = cur; row.classList.add('param-dirty'); row.classList.remove('param-sent'); }
            else { delete dirtyParams[name]; row.classList.remove('param-dirty'); }
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const v = parseFloat(input.value);
                if (!isNaN(v)) wsSend({ type: 'param_set', param_id: name, value: v });
                input.blur();
            }
            if (e.key === 'Escape') { input.value = fmtV(parseFloat(input.dataset.original)); delete dirtyParams[name]; row.classList.remove('param-dirty'); input.blur(); }
        });
    }

    // --- Select / combobox ---
    // Behaves same as numeric input: marks dirty, waits for "Write Changed" button.
    const sel = row.querySelector('.param-val-select');
    if (sel) {
        sel.addEventListener('change', () => {
            const orig = parseFloat(sel.dataset.original), cur = parseFloat(sel.value);
            if (!isNaN(cur) && cur !== orig) {
                dirtyParams[name] = cur;
                row.classList.add('param-dirty');
                row.classList.remove('param-sent');
            } else {
                delete dirtyParams[name];
                row.classList.remove('param-dirty');
            }
        });
    }
}

    function upsertRow(name) {
        const tbody = document.getElementById('fpBody'); if (!tbody) return;
        const p = allParams[name]; if (!p) return;
        let row = tbody.querySelector('tr[data-param="'+CSS.escape(name)+'"]');
        if (!row) {
            row = document.createElement('tr'); row.dataset.param = name; row.innerHTML = makeRowHTML(p);
            let ins = false;
            for (const r of Array.from(tbody.querySelectorAll('tr[data-param]')))
                if (r.dataset.param > name) { tbody.insertBefore(row, r); ins = true; break; }
            if (!ins) tbody.appendChild(row);
            attachRowEvents(row);
        } else {
            // Update numeric input
            const inp = row.querySelector('.param-val-input');
            if (inp && document.activeElement !== inp) { inp.value = fmtV(p.value); inp.dataset.original = p.value; }
            // Update select
            const sel = row.querySelector('.param-val-select');
            if (sel && document.activeElement !== sel) {
                sel.dataset.original = p.value;
                // Try to select matching option
                for (const opt of sel.options) {
                    if (parseFloat(opt.value) === parseFloat(p.value)) { sel.value = opt.value; break; }
                }
            }
        }
    }

    function rebuildTable() {
        const tbody = document.getElementById('fpBody'); if (!tbody) return;
        const q    = (document.getElementById('fpSearch')?.value || '').toLowerCase();
        const type = (document.getElementById('fpFilterType')?.value || 'all');
        const sorted = Object.values(allParams).sort((a, b) => a.name.localeCompare(b.name));
        tbody.innerHTML = ''; let vis = 0;
        sorted.forEach(p => {
            const m = getMeta(p.name);
            // Text match
            const textOk = !q || p.name.toLowerCase().includes(q)
                || (m.d || '').toLowerCase().includes(q)
                || (m.r || '').toLowerCase().includes(q)
                || (m.u || '').toLowerCase().includes(q);
            // Type filter
            let typeOk = true;
            if (type === 'options')  typeOk = !!(m.options && m.options.length);
            else if (type === 'bitmask') typeOk = !!m.isBitmask;
            else if (type === 'range')   typeOk = !!(m.r && !m.options && !m.isBitmask);
            else if (type === 'reboot')  typeOk = !!m.reboot;
            const match = textOk && typeOk;
            const row = document.createElement('tr');
            row.dataset.param = p.name;
            row.style.display = match ? '' : 'none';
            row.innerHTML = makeRowHTML(p);
            tbody.appendChild(row);
            attachRowEvents(row);
            if (match) vis++;
        });
        setStatus(vis + ' parameters' + (q || type !== 'all' ? ' (filtered)' : ' loaded'));
    }

    function filterTable() {
        const q    = (document.getElementById('fpSearch')?.value || '').toLowerCase();
        const type = (document.getElementById('fpFilterType')?.value || 'all');
        let vis = 0;
        document.querySelectorAll('#fpBody tr[data-param]').forEach(r => {
            const name = r.dataset.param;
            const m    = getMeta(name);
            // Text filter
            const textOk = !q || r.textContent.toLowerCase().includes(q);
            // Type filter
            let typeOk = true;
            if (type === 'options')  typeOk = !!(m && m.options && m.options.length);
            else if (type === 'bitmask') typeOk = !!(m && m.isBitmask);
            else if (type === 'range')   typeOk = !!(m && m.r && !m.options && !m.isBitmask);
            else if (type === 'reboot')  typeOk = !!(m && m.reboot);
            const match = textOk && typeOk;
            r.style.display = match ? '' : 'none';
            if (match) vis++;
        });
        setStatus(vis + ' parameters' + (q || type !== 'all' ? ' (filtered)' : ' loaded'));
    }

    function fmtV(v){ if(Number.isInteger(v)) return String(v); return parseFloat(v.toPrecision(7)).toString(); }
    function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function injectCSS() {
        if (document.getElementById('fp-style')) return;
        const s = document.createElement('style'); s.id = 'fp-style';
        s.textContent = `
/* ── Table layout ── */
.fp-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}
.fp-table thead th{position:sticky;top:0;z-index:2;background:var(--bg-raised,#1a1a2e);padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:var(--text-muted,#888);border-bottom:2px solid var(--border-muted,#333);white-space:nowrap;text-transform:uppercase;letter-spacing:.8px}
.fp-table tbody tr{border-bottom:1px solid rgba(255,255,255,.04);transition:background .12s}
.fp-table tbody tr:hover{background:rgba(255,255,255,.04)}

/* ── Column widths ── */
.fp-n{width:190px;padding:8px 10px;vertical-align:middle}
.fp-v{width:160px;padding:5px 8px;text-align:right;vertical-align:middle}
.fp-v-sel{width:210px;padding:4px 6px;vertical-align:middle}
.fp-u{width:64px;padding:8px 6px;color:var(--text-muted,#888);font-size:11px;white-space:nowrap;vertical-align:middle}
.fp-r{width:240px;padding:7px 8px;vertical-align:top}
.fp-d{width:auto;padding:7px 10px;vertical-align:top}

/* ── Parameter name badge ── */
.fp-param-name{font-family:monospace;font-size:12px;color:var(--text-primary,#eee);background:rgba(230,0,126,.08);border:1px solid rgba(230,0,126,.18);border-radius:4px;padding:2px 6px;display:inline-block;white-space:nowrap;max-width:170px;overflow:hidden;text-overflow:ellipsis}

/* ── Numeric input ── */
.param-val-input{background:transparent;border:1px solid transparent;color:var(--accent,#E6007E);font-size:13px;font-family:monospace;text-align:right;width:100%;outline:none;cursor:pointer;border-radius:4px;padding:3px 6px;transition:all .15s}
.param-val-input:hover{border-color:rgba(230,0,126,.3);background:rgba(230,0,126,.04)}
.param-val-input:focus{background:var(--accent-dim,rgba(230,0,126,.1));border-color:var(--accent,#E6007E);box-shadow:0 0 0 2px rgba(230,0,126,.15)}

/* ── Select / combobox ── */
.param-val-select{width:100%;background:var(--bg-surface,#111827);border:1px solid var(--border-muted,#333);color:var(--accent,#E6007E);font-size:12px;font-family:monospace;border-radius:6px;padding:5px 8px;outline:none;cursor:pointer;transition:border-color .15s}
.param-val-select:hover{border-color:rgba(230,0,126,.5)}
.param-val-select:focus{border-color:var(--accent,#E6007E);box-shadow:0 0 0 2px rgba(230,0,126,.2)}
.param-val-select option{background:var(--bg-surface,#111827);color:var(--text-primary,#eee)}

/* ── Range badge ── */
.fp-range-badge{display:inline-block;background:rgba(100,200,255,.08);border:1px solid rgba(100,200,255,.2);color:rgba(120,210,255,.85);font-size:11px;border-radius:4px;padding:1px 6px;font-family:monospace;white-space:nowrap}
.fp-inc{font-size:10px;color:var(--text-muted,#666);margin-left:4px}

/* ── Bitmask bits ── */
.fp-r-bits{vertical-align:top;padding:6px 8px}
.fp-bit{display:inline-block;background:rgba(180,120,255,.10);border:1px solid rgba(180,120,255,.25);border-radius:4px;font-size:10px;padding:1px 5px;margin:2px 2px 2px 0;color:rgba(200,160,255,.9);white-space:nowrap}
.fp-bit b{color:rgba(210,180,255,1);font-size:9px;margin-right:2px}

/* ── Options summary ── */
.fp-r-opts{font-size:10px;color:var(--text-muted,#888);vertical-align:middle}
.fp-more{font-size:9px;color:rgba(230,0,126,.7);margin-left:2px}

/* ── Description cell ── */
.fp-desc-text{color:var(--text-secondary,#bbb);font-size:12px;line-height:1.5}
.fp-reboot-badge{display:inline-block;background:rgba(255,150,0,.12);border:1px solid rgba(255,150,0,.3);color:rgba(255,190,50,.9);font-size:9px;border-radius:4px;padding:1px 6px;margin-top:4px;margin-right:4px;font-weight:600;letter-spacing:.3px;text-transform:uppercase}
.fp-unit-text{display:inline-block;font-size:10px;color:var(--text-muted,#666);margin-top:4px;font-style:italic}

/* ── Dirty / sent rows ── */
tr.param-dirty .fp-param-name{border-color:rgba(230,180,0,.5);background:rgba(230,180,0,.1)}
tr.param-dirty td{background:rgba(230,180,0,.04)}
tr.param-sent .fp-param-name{border-color:rgba(0,220,100,.4);background:rgba(0,220,100,.08)}
tr.param-sent td{background:rgba(0,200,80,.04)}`;
        document.head.appendChild(s);
    }

    function render() {
        return `<div class="settings-panel-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
  <span>Full Parameter List</span>
  <div style="display:flex; align-items:center; gap:10px;">
    <span id="fpDroneBadge" style="display:none; background:rgba(79,195,247,.12); border:1px solid rgba(79,195,247,.3); color:#4fc3f7; font-size:11px; font-family:monospace; border-radius:5px; padding:3px 9px; font-weight:700; letter-spacing:.04em;"></span>
    <div class="drone-selector-wrap-container"></div>
  </div>
</div>
<div class="calib-card param-full-card">
  <div class="param-toolbar" style="gap:10px;flex-wrap:wrap">
    <input type="text" class="param-search-bar" id="fpSearch" placeholder="\uD83D\uDD0D Search by name, description, units or options\u2026">
    <select id="fpFilterType" class="param-search-bar" style="flex:0 0 auto;width:160px">
      <option value="all">All Parameters</option>
      <option value="options">With Options (dropdowns)</option>
      <option value="bitmask">Bitmask Parameters</option>
      <option value="range">Numeric Range Only</option>
      <option value="reboot">Reboot Required</option>
    </select>
    <button class="calib-btn calib-btn-secondary" id="fpRefreshBtn" style="white-space:nowrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Refresh
    </button>
  </div>
  <div id="fpPWrap" style="display:none;align-items:center;gap:10px;margin-bottom:10px">
    <div style="flex:1;background:var(--bg-raised,#222);border-radius:4px;height:6px;overflow:hidden">
      <div id="fpPBar" style="height:100%;background:var(--accent,#E6007E);width:0%;transition:width .15s"></div>
    </div>
    <span id="fpPTxt" style="font-size:11px;color:var(--text-muted,#888);white-space:nowrap"></span>
  </div>
  <div class="param-table-wrap">
    <table class="fp-table">
      <thead><tr>
        <th class="fp-n">Parameter</th>
        <th class="fp-v" style="text-align:right">Value / Select</th>
        <th class="fp-u">Units</th>
        <th class="fp-r">Range / Options</th>
        <th class="fp-d">Full Description</th>
      </tr></thead>
      <tbody id="fpBody"></tbody>
    </table>
  </div>
  <div class="param-table-footer">
    <span id="fpCount">No parameters \u2014 click Refresh</span>
    <div class="calib-actions" style="margin:0;display:flex;gap:8px;flex-wrap:wrap">
      <button class="calib-btn calib-btn-primary"   style="padding:8px 16px;font-size:12px" id="fpWriteBtn">Write Changed</button>
      <button class="calib-btn calib-btn-secondary" style="padding:8px 14px;font-size:12px" id="fpSaveBtn">Save to File</button>
      <button class="calib-btn calib-btn-secondary" style="padding:8px 14px;font-size:12px" id="fpLoadBtn">Load from File</button>
    </div>
  </div>
</div>`;
    }

function init() {
    const host = document.getElementById('panel-param-full'); if (!host) return;
    injectCSS(); host.innerHTML = render();

    loadExternalMeta().then(() => {
        document.getElementById('fpSearch')?.addEventListener('input', filterTable);
        document.getElementById('fpFilterType')?.addEventListener('change', filterTable);
        document.getElementById('fpRefreshBtn')?.addEventListener('click', () => {
            // Clear stale params before refreshing for a different drone
            allParams = {}; dirtyParams = {};
            document.getElementById('fpBody').innerHTML = '';
            wsSend({ type: 'param_request_list' });
        });

        document.getElementById('fpWriteBtn')?.addEventListener('click', () => {
            const names = Object.keys(dirtyParams);
            if (!names.length) { const { toast } = window.SwUtil || {}; if (toast) toast('No changed parameters'); return; }

            if (window.selectedSysId === 0 && window.activeSysids && window.activeSysids.length > 0) {
                // Write all dirty params to EVERY connected drone
                names.forEach(n => {
                    window.activeSysids.forEach(sysid => {
                        window.ws.send(JSON.stringify({ type: 'param_set', param_id: n, value: dirtyParams[n], sysid }));
                    });
                });
                const { toast } = window.SwUtil || {};
                if (toast) toast('Writing ' + names.length + ' param(s) to all drones');
                console.log('[ParamFull] Broadcasted ' + names.length + ' param(s) to all drones');
            } else {
                names.forEach(n => wsSend({ type: 'param_set', param_id: n, value: dirtyParams[n] }));
            }
        });

        document.getElementById('fpSaveBtn')?.addEventListener('click', () => wsSend({ type: 'param_save_file' }));

        document.getElementById('fpLoadBtn')?.addEventListener('click', () => {
            const p = window.prompt('Enter .param file path on GCS:', 'params.param');
            if (p && p.trim()) wsSend({ type: 'param_load_file', path: p.trim() });
        });

        // ── Listen to CustomEvents dispatched by websocket.js ─────────────────
        if (!window._fpBound) {
            window._fpBound = true;

            const paramTypes = [
                'param_load_start', 'param_load_progress', 'param_load_complete',
                'param_value', 'param_all', 'param_set_sent',
                'param_file_saved', 'param_file_loaded', 'param_error'
            ];
            paramTypes.forEach(evtName => {
                window.addEventListener(evtName, e => handleMessage(e.detail));
            });

            // Re-request after reconnect if panel is open and cache is empty
            window.addEventListener('ws_connected', () => {
                if (document.getElementById('panel-param-full') &&
                    Object.keys(allParams).length === 0) {
                    wsSend({ type: 'param_request_list' });
                }
            });

            // ── Re-fetch when the user selects a different drone ──────────────
            window.addEventListener('vehicle_selected', () => {
                const panelActive = document.querySelector('#panel-param-full.active') ||
                                    document.querySelector('#panel-param-full[style*="block"]');
                // Only auto-refresh if the Full Params panel is currently visible
                const host2 = document.getElementById('panel-param-full');
                if (host2 && host2.classList.contains('active')) {
                    allParams = {}; dirtyParams = {};
                    const tbody = document.getElementById('fpBody');
                    if (tbody) tbody.innerHTML = '';
                    setStatus('Switching drone — fetching parameters…');
                    wsSend({ type: 'param_request_list' });
                }
            });
        }

        // Initialise drone badge on first open
        const targetSysid = (window.selectedSysId && window.selectedSysId > 0)
            ? window.selectedSysId
            : (window.activeSysids && window.activeSysids.length > 0 ? window.activeSysids[0] : 1);
        _currentParamSysid = targetSysid;
        _updateDroneBadge();
        if (window.updateAllDroneSelectors) window.updateAllDroneSelectors();

        // Always re-fetch if cache is empty OR if the cached drone differs from
        // the currently selected drone (user switched drones before opening panel)
        if (Object.keys(allParams).length === 0 || _currentParamSysid !== targetSysid) {
            allParams = {}; dirtyParams = {};
            const tbody = document.getElementById('fpBody');
            if (tbody) tbody.innerHTML = '';
            wsSend({ type: 'param_request_list' });
        } else {
            rebuildTable();
            setStatus(Object.keys(allParams).length + ' parameters loaded (cached)');
        }
    });
}

    window.ParamFull={ init, handleMessage };
    console.log('\u2705 ParamFull ready (metadata enabled)');
})();