import os
os.environ['MAVLINK20'] = '1'

import socket
import sys
import time
import json
import threading
import subprocess
import re
import select
import math
import http.server
import argparse
from collections import deque
from pymavlink.dialects.v20 import ardupilotmega as mavlink

# Global State and Statistics
message_log = []
log_lock = threading.Lock()
crc_failures = 0
HTTP_PORT = 14599
muted_sysids = set()

# Message Coverage State
REQUIRED_MESSAGES = {
    "HEARTBEAT", "COMMAND_LONG", "COMMAND_ACK", "PARAM_SET", "PARAM_VALUE",
    "MISSION_COUNT", "MISSION_ITEM_INT", "MISSION_ACK", "STATUSTEXT", "GLOBAL_POSITION_INT"
}
OPTIONAL_MESSAGES = {
    "SYS_STATUS", "GPS_RAW_INT", "ATTITUDE", "VFR_HUD"
}

# Per-vehicle tracking database
vehicles_data = {}

def get_vehicle_data(sysid):
    if sysid not in vehicles_data:
        vehicles_data[sysid] = {
            "seq_state": {
                "SITL_TO_GCS": {"gaps": 0, "duplicates": 0, "out_of_order": 0, "received": 0, "lost": 0, "last_seqs": {}},
                "GCS_TO_SITL": {"gaps": 0, "duplicates": 0, "out_of_order": 0, "received": 0, "lost": 0, "last_seqs": {}}
            },
            "observed_required": set(),
            "observed_optional": set(),
            "rates_state": {
                "heartbeat": deque(),
                "gps": deque(),
                "sys_status": deque(),
                "attitude": deque(),
                "all": deque()
            },
            "hb_timestamps": deque(maxlen=30),
            "hb_intervals": deque(maxlen=30),
            "pending_commands": {},
            "arm_latency_ms": None,
            "mode_latency_ms": None,
            "pending_mode_change": None,
            "download_state": {
                "in_progress": False,
                "current_seq": 0,
                "total_count": 0,
                "items_received": [],
                "last_request_time": 0.0,
                "attempts": 0,
                "completed": False,
                "error": None
            },
            "last_observed_compid": 1,
            "sitl_sock": None,
            "mavproxy_dest": None
        }
    return vehicles_data[sysid]

# GCS socket dynamic destination endpoint
latest_gcs_endpoint = None

# Parser helpers
mav_sitl = mavlink.MAVLink(None)
mav_sitl.srcSystem = 255
mav_sitl.srcComponent = 190

def send_mission_request_int(sysid, seq):
    global mav_sitl
    v = get_vehicle_data(sysid)
    sock = v.get("sitl_sock")
    dest = v.get("mavproxy_dest")
    if sock and dest and mav_sitl:
        compid = v.get("last_observed_compid", 1)
        msg = mav_sitl.mission_request_int_encode(sysid, compid, seq, 0)
        packed = msg.pack(mav_sitl)
        print(f"[Proxy DBG] send_mission_request_int: sysid={sysid} seq={seq} target compid={compid}, destination={dest}", flush=True)
        sock.sendto(packed, dest)

def send_mission_ack(sysid, ack_type):
    global mav_sitl
    v = get_vehicle_data(sysid)
    sock = v.get("sitl_sock")
    dest = v.get("mavproxy_dest")
    if sock and dest and mav_sitl:
        compid = v.get("last_observed_compid", 1)
        msg = mav_sitl.mission_ack_encode(sysid, compid, ack_type, 0)
        packed = msg.pack(mav_sitl)
        print(f"[Proxy DBG] send_mission_ack: sysid={sysid} ack_type={ack_type} target compid={compid}, destination={dest}", flush=True)
        sock.sendto(packed, dest)

def handle_faked_download(sysid, msg):
    v = get_vehicle_data(sysid)
    download_state = v["download_state"]
    if not download_state["in_progress"]:
        return False
        
    msg_type = msg.get_type()
    print(f"[Proxy DBG] handle_faked_download: sysid={sysid} msg_type={msg_type} fields={msg.to_dict()}", flush=True)
    if msg_type == "MISSION_COUNT":
        download_state["total_count"] = msg.count
        download_state["current_seq"] = 0
        download_state["items_received"] = []
        download_state["last_request_time"] = time.time()
        download_state["attempts"] = 1
        if msg.count > 0:
            send_mission_request_int(sysid, 0)
        else:
            send_mission_ack(sysid, 0)  # MAV_MISSION_ACCEPTED = 0
            download_state["in_progress"] = False
            download_state["completed"] = True
        return True
    elif msg_type in ("MISSION_ITEM_INT", "MISSION_ITEM"):
        seq = msg.seq
        if seq == download_state["current_seq"]:
            download_state["items_received"].append(msg.to_dict())
            download_state["current_seq"] += 1
            download_state["last_request_time"] = time.time()
            download_state["attempts"] = 1
            if download_state["current_seq"] < download_state["total_count"]:
                send_mission_request_int(sysid, download_state["current_seq"])
            else:
                send_mission_ack(sysid, 0)  # MAV_MISSION_ACCEPTED = 0
                download_state["in_progress"] = False
                download_state["completed"] = True
        return True
    return False

def get_host_ip():
    try:
        out = subprocess.check_output(['ip', 'route']).decode('utf-8')
        match = re.search(r'default via ([\d\.]+)', out)
        if match:
            return match.group(1)
    except Exception:
        pass
    return '127.0.0.1'

def update_sequence_stats(direction, sysid, compid, seq):
    v = get_vehicle_data(sysid)
    state = v["seq_state"][direction]
    state["received"] += 1
    
    key = (sysid, compid)
    last = state["last_seqs"].get(key)
    if last is None:
        state["last_seqs"][key] = seq
        return
        
    diff = (seq - last) % 256
    if diff == 0:
        state["duplicates"] += 1
    elif diff == 1:
        pass  # expected sequence
    elif diff > 1:
        if diff > 200:
            state["out_of_order"] += 1
        else:
            lost_count = diff - 1
            state["gaps"] += lost_count
            state["lost"] += lost_count
            
    state["last_seqs"][key] = seq

def track_message(direction, msg, sock=None, addr=None):
    global crc_failures
    
    now = time.time()
    
    if isinstance(msg, mavlink.MAVLink_bad_data):
        crc_failures += 1
        return
        
    sysid = msg.get_srcSystem()
    if direction == "GCS_TO_SITL":
        target_sys = getattr(msg, 'target_system', None)
        if target_sys and target_sys != 0:
            sysid = target_sys

    v = get_vehicle_data(sysid)
    v["rates_state"]["all"].append(now)
    
    if direction == "SITL_TO_GCS":
        if sock:
            v["sitl_sock"] = sock
        if addr:
            v["mavproxy_dest"] = addr
        v["last_observed_compid"] = msg.get_srcComponent()
        
    msg_type = msg.get_type()
    if direction == "GCS_TO_SITL":
        print(f"[Proxy DBG] GCS packet parsed: msg_type={msg_type} fields={msg.to_dict()}", flush=True)
        
    # Coverage tracking
    if msg_type in REQUIRED_MESSAGES:
        v["observed_required"].add(msg_type)
    elif msg_type in OPTIONAL_MESSAGES:
        v["observed_optional"].add(msg_type)
        
    # SysID/CompID tracking via HEARTBEAT
    if msg_type == "HEARTBEAT" and direction == "SITL_TO_GCS":
        # Jitter tracking
        v["hb_timestamps"].append(now)
        if len(v["hb_timestamps"]) >= 2:
            interval = v["hb_timestamps"][-1] - v["hb_timestamps"][-2]
            v["hb_intervals"].append(interval)
            
        # Mode switch latency tracking
        if v["pending_mode_change"]:
            curr_mode = getattr(msg, 'custom_mode', None)
            print(f"[Proxy DBG] checking heartbeat mode: sysid={sysid} current={curr_mode}, pending={v['pending_mode_change']['custom_mode']}", flush=True)
            if curr_mode == v["pending_mode_change"]["custom_mode"]:
                v["mode_latency_ms"] = (now - v["pending_mode_change"]["time"]) * 1000.0
                print(f"[Proxy DBG] mode latency matched for sysid={sysid}: {v['mode_latency_ms']} ms", flush=True)
                v["pending_mode_change"] = None
                
    # Frequency Tracking
    if msg_type == "HEARTBEAT":
        v["rates_state"]["heartbeat"].append(now)
    elif msg_type == "GLOBAL_POSITION_INT":
        v["rates_state"]["gps"].append(now)
    elif msg_type == "SYS_STATUS":
        v["rates_state"]["sys_status"].append(now)
    elif msg_type == "ATTITUDE":
        v["rates_state"]["attitude"].append(now)
        
    # Command Latency matching
    target_sys = sysid
    if direction == "GCS_TO_SITL" and hasattr(msg, 'target_system'):
        target_sys = msg.target_system
        
    v_target = get_vehicle_data(target_sys)
        
    if direction == "GCS_TO_SITL" and msg_type == "COMMAND_LONG":
        v_target["pending_commands"][msg.command] = now
        # Mode Change command is 176 (MAV_CMD_DO_SET_MODE)
        if msg.command == 176:
            v_target["pending_mode_change"] = { "custom_mode": int(msg.param2), "time": now }
            print(f"[Proxy DBG] set pending_mode_change for sysid={target_sys} (COMMAND_LONG): {v_target['pending_mode_change']}", flush=True)
            
    elif direction == "GCS_TO_SITL" and msg_type == "SET_MODE":
        v_target["pending_mode_change"] = { "custom_mode": int(msg.custom_mode), "time": now }
        print(f"[Proxy DBG] set pending_mode_change for sysid={target_sys} (SET_MODE): {v_target['pending_mode_change']}", flush=True)
        
    elif direction == "SITL_TO_GCS" and msg_type == "COMMAND_ACK":
        cmd_id = msg.command
        print(f"[Proxy DBG] Intercepted COMMAND_ACK: command={cmd_id} sysid={sysid} pending={list(v['pending_commands'].keys()) if 'pending_commands' in v else None}", flush=True)
        if cmd_id in v["pending_commands"]:
            latency = (now - v["pending_commands"][cmd_id]) * 1000.0
            if cmd_id == 400:  # MAV_CMD_COMPONENT_ARM_DISARM
                v["arm_latency_ms"] = latency
            del v["pending_commands"][cmd_id]

    # Save to JSON log
    log_entry = {
        "timestamp": now,
        "direction": direction,
        "msg_type": msg_type,
        "sysid": msg.get_srcSystem(),
        "compid": msg.get_srcComponent(),
        "seq": msg.get_seq(),
        "fields": msg.to_dict()
    }
    with log_lock:
        message_log.append(log_entry)
        if len(message_log) > 5000:
            message_log.pop(0)

def compute_stats():
    now = time.time()
    
    vehicles_stats = {}
    for sysid, v in vehicles_data.items():
        # prune rates
        cutoff = now - 5.0
        for key in v["rates_state"]:
            dq = v["rates_state"][key]
            while dq and dq[0] < cutoff:
                dq.popleft()
                
        # Calculate Hz over last 5 seconds
        hz_all = len(v["rates_state"]["all"]) / 5.0
        hz_hb = len(v["rates_state"]["heartbeat"]) / 5.0
        hz_gps = len(v["rates_state"]["gps"]) / 5.0
        hz_sys = len(v["rates_state"]["sys_status"]) / 5.0
        hz_att = len(v["rates_state"]["attitude"]) / 5.0
        
        # Jitter calculation (std deviation of HEARTBEAT intervals in ms)
        jitter = 0.0
        if len(v["hb_intervals"]) >= 2:
            mean_int = sum(v["hb_intervals"]) / len(v["hb_intervals"])
            variance = sum((x - mean_int) ** 2 for x in v["hb_intervals"]) / len(v["hb_intervals"])
            jitter = math.sqrt(variance) * 1000.0  # to ms
            
        # Packet loss calculation
        total_received = v["seq_state"]["SITL_TO_GCS"]["received"] + v["seq_state"]["GCS_TO_SITL"]["received"]
        total_lost = v["seq_state"]["SITL_TO_GCS"]["lost"] + v["seq_state"]["GCS_TO_SITL"]["lost"]
        loss_pct = 0.0
        if (total_received + total_lost) > 0:
            loss_pct = (total_lost / (total_received + total_lost)) * 100.0
            
        # Compliance calculation
        compliance_pct = (len(v["observed_required"]) / len(REQUIRED_MESSAGES)) * 100.0
        optional_pct = (len(v["observed_optional"]) / len(OPTIONAL_MESSAGES)) * 100.0
        
        total_gaps = v["seq_state"]["SITL_TO_GCS"]["gaps"] + v["seq_state"]["GCS_TO_SITL"]["gaps"]
        total_duplicates = v["seq_state"]["SITL_TO_GCS"]["duplicates"] + v["seq_state"]["GCS_TO_SITL"]["duplicates"]
        total_out_of_order = v["seq_state"]["SITL_TO_GCS"]["out_of_order"] + v["seq_state"]["GCS_TO_SITL"]["out_of_order"]

        seq_stats_json = {}
        for direction in v["seq_state"]:
            d_stats = v["seq_state"][direction].copy()
            d_stats.pop("last_seqs", None)
            seq_stats_json[direction] = d_stats

        vehicles_stats[str(sysid)] = {
            "last_observed_sysid": sysid,
            "last_observed_compid": v.get("last_observed_compid", 1),
            "compliance_score": compliance_pct,
            "optional_coverage": optional_pct,
            "observed_required": list(v["observed_required"]),
            "observed_optional": list(v["observed_optional"]),
            "packet_loss_pct": loss_pct,
            "packets_received": total_received,
            "packets_lost": total_lost,
            "crc_failures": v["crc_failures"] if "crc_failures" in v else 0,
            "sequence_gaps": total_gaps,
            "duplicate_sequences": total_duplicates,
            "out_of_order_sequences": total_out_of_order,
            "sequence_stats": seq_stats_json,
            "telemetry_hz": hz_all,
            "heartbeat_hz": hz_hb,
            "gps_hz": hz_gps,
            "sys_status_hz": hz_sys,
            "attitude_hz": hz_att,
            "jitter_ms": jitter,
            "arm_latency_ms": v["arm_latency_ms"],
            "mode_latency_ms": v["mode_latency_ms"],
            "download_completed": v["download_state"]["completed"],
            "download_item_count": len(v["download_state"]["items_received"]),
            "download_error": v["download_state"]["error"]
        }

    # Aggregate result
    res = {
        "vehicles": vehicles_stats,
        "crc_failures": crc_failures,
        "latest_gcs_endpoint": f"{latest_gcs_endpoint[0]}:{latest_gcs_endpoint[1]}" if latest_gcs_endpoint else None
    }
    
    # Backward compatibility for Phase 4 single-vehicle tests
    if "1" in vehicles_stats:
        res.update(vehicles_stats["1"])
        
    return res

# HTTP status REST API server
class ProxyHTTPHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == '/messages':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with log_lock:
                self.wfile.write(json.dumps(message_log).encode('utf-8'))
        elif self.path == '/stats':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            stats = compute_stats()
            self.wfile.write(json.dumps(stats).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global crc_failures, muted_sysids
        if self.path == '/reset':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with log_lock:
                message_log.clear()
            vehicles_data.clear()
            muted_sysids.clear()
            crc_failures = 0
            self.wfile.write(b"OK")
        elif self.path.startswith('/mute'):
            from urllib.parse import urlparse, parse_qs
            query = urlparse(self.path).query
            params = parse_qs(query)
            sysid = 1
            if 'sysid' in params:
                try:
                    sysid = int(params['sysid'][0])
                except:
                    pass
            muted_sysids.add(sysid)
            print(f"[Proxy] Muted vehicle {sysid}", flush=True)
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b"OK")
        elif self.path.startswith('/unmute'):
            from urllib.parse import urlparse, parse_qs
            query = urlparse(self.path).query
            params = parse_qs(query)
            sysid = 1
            if 'sysid' in params:
                try:
                    sysid = int(params['sysid'][0])
                except:
                    pass
            muted_sysids.discard(sysid)
            print(f"[Proxy] Unmuted vehicle {sysid}", flush=True)
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b"OK")
        elif self.path.startswith('/trigger_download'):
            from urllib.parse import urlparse, parse_qs
            query = urlparse(self.path).query
            params = parse_qs(query)
            sysid = 1
            if 'sysid' in params:
                try:
                    sysid = int(params['sysid'][0])
                except:
                    pass
                    
            v = get_vehicle_data(sysid)
            sock = v.get("sitl_sock")
            dest = v.get("mavproxy_dest")
            if not sock or not dest:
                self.send_response(400)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(f"Error: SITL vehicle {sysid} endpoint not yet discovered".encode())
                return
            
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            download_state = v["download_state"]
            download_state["in_progress"] = True
            download_state["current_seq"] = 0
            download_state["total_count"] = 0
            download_state["items_received"] = []
            download_state["last_request_time"] = time.time()
            download_state["attempts"] = 1
            download_state["completed"] = False
            download_state["error"] = None
            
            # Send the MISSION_REQUEST_LIST
            compid = v.get("last_observed_compid", 1)
            msg = mav_sitl.mission_request_list_encode(sysid, compid, 0)
            sock.sendto(msg.pack(mav_sitl), dest)
            self.wfile.write(b"OK")
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def run_http_server():
    global HTTP_PORT
    server = http.server.HTTPServer(('0.0.0.0', HTTP_PORT), ProxyHTTPHandler)
    server.serve_forever()

def main():
    global latest_gcs_endpoint, HTTP_PORT, mav_sitl, muted_sysids
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--sitl-ports', type=str, default='14590')
    parser.add_argument('--gcs-port', type=int, default=14550)
    parser.add_argument('--http-port', type=int, default=14599)
    args = parser.parse_args()
    
    sitl_ports = [int(p) for p in args.sitl_ports.split(',')]
    HTTP_PORT = args.http_port
    
    # Launch HTTP API thread
    http_thread = threading.Thread(target=run_http_server)
    http_thread.daemon = True
    http_thread.start()
    print(f"[Proxy] HTTP status API running on port {HTTP_PORT}")
    
    host_ip = get_host_ip()
    print(f"[Proxy] Found Windows Host IP: {host_ip}")
    
    # ── Sockets setup ──
    sitl_socks = {}
    sitl_dests = {}
    mav_sitl_parsers = {}
    for port in sitl_ports:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.bind(('127.0.0.1', port))
        s.setblocking(0)
        sitl_socks[port] = s
        print(f"[Proxy] Bound to SITL port {port}")
        
        p = mavlink.MAVLink(None)
        p.srcSystem = 255
        p.srcComponent = 190
        mav_sitl_parsers[port] = p
    
    gcs_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    gcs_sock.bind(('0.0.0.0', 0))
    gcs_sock.setblocking(0)
    
    latest_gcs_endpoint = (host_ip, args.gcs_port)
    
    mav_gcs = mavlink.MAVLink(None)
    
    print(f"[Proxy] Proxying: SITL ports {sitl_ports} <-> GCS ({host_ip}:{args.gcs_port})")
    print(f"[Proxy] Outbound GCS socket bound to dynamic port: {gcs_sock.getsockname()[1]}")
    
    inputs = list(sitl_socks.values()) + [gcs_sock]
    
    while True:
        try:
            readable, _, _ = select.select(inputs, [], [], 1.0)
            
            # Timeout / retry logic for faked downloads
            for sysid, v in list(vehicles_data.items()):
                download_state = v["download_state"]
                if download_state["in_progress"] and time.time() - download_state["last_request_time"] > 1.0:
                    if download_state["attempts"] < 3:
                        download_state["attempts"] += 1
                        download_state["last_request_time"] = time.time()
                        dest = v.get("mavproxy_dest")
                        sock = v.get("sitl_sock")
                        compid = v.get("last_observed_compid", 1)
                        print(f"[Proxy DBG] retry: sysid={sysid} attempt={download_state['attempts']} total_count={download_state['total_count']} seq={download_state['current_seq']} dest={dest}", flush=True)
                        if download_state["total_count"] == 0:
                            msg = mav_sitl.mission_request_list_encode(sysid, compid, 0)
                            sock.sendto(msg.pack(mav_sitl), dest)
                        else:
                            send_mission_request_int(sysid, download_state["current_seq"])
                    else:
                        download_state["in_progress"] = False
                        download_state["error"] = "Timeout"
                        print(f"[Proxy DBG] download handshake TIMEOUT for sysid={sysid} (reached max attempts)", flush=True)

            for s in readable:
                if s in sitl_socks.values():
                    # Packet from one of the SITLs
                    data, addr = s.recvfrom(2048)
                    
                    # Find which port this corresponds to
                    sport = None
                    for p, sock in sitl_socks.items():
                        if sock is s:
                            sport = p
                            break
                            
                    sitl_dests[sport] = addr
                    
                    # Parse packet
                    skip_forward = False
                    try:
                        msgs = mav_sitl_parsers[sport].parse_buffer(data)
                        if msgs:
                            for msg in msgs:
                                sysid = msg.get_srcSystem()
                                if sysid in muted_sysids:
                                    skip_forward = True
                                    break
                                    
                                if not isinstance(msg, mavlink.MAVLink_bad_data):
                                    update_sequence_stats("SITL_TO_GCS", sysid, msg.get_srcComponent(), msg.get_seq())
                                track_message("SITL_TO_GCS", msg, sock=s, addr=addr)
                                # Handle proxy faked download handshake
                                if handle_faked_download(sysid, msg):
                                    skip_forward = True
                    except Exception as e:
                        pass
                        
                    # Forward to GCS on Windows
                    if not skip_forward and latest_gcs_endpoint:
                        gcs_sock.sendto(data, latest_gcs_endpoint)
                    
                elif s is gcs_sock:
                    # Reply packet from GCS on Windows
                    data, addr = gcs_sock.recvfrom(2048)
                    latest_gcs_endpoint = addr  # Track latest GCS endpoint
                    
                    # Parse packet
                    try:
                        msgs = mav_gcs.parse_buffer(data)
                        if msgs:
                            for msg in msgs:
                                if not isinstance(msg, mavlink.MAVLink_bad_data):
                                    active_sysids = [k for k in vehicles_data.keys() if k != 255]
                                    if not active_sysids:
                                        active_sysids = [1]
                                    for active_id in active_sysids:
                                        update_sequence_stats("GCS_TO_SITL", active_id, msg.get_srcComponent(), msg.get_seq())
                                track_message("GCS_TO_SITL", msg)
                    except Exception as e:
                        pass
                        
                    # Forward back to all registered MAVProxy endpoints (skipping muted ones)
                    for sport, dest in list(sitl_dests.items()):
                        sysid_of_port = sport - 14590 + 1
                        if sysid_of_port in muted_sysids:
                            continue
                        sock = sitl_socks[sport]
                        sock.sendto(data, dest)
                        
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[Proxy ERROR] Loop error: {e}", file=sys.stderr)
            time.sleep(0.1)

if __name__ == '__main__':
    main()
