# TiHANFly GCS Multi-Vehicle Connection Architecture

This document outlines the architecture of how the TiHANFly Ground Control Station (GCS) connects to and manages multiple vehicles simultaneously using different communication protocols (TCP, UDP, and Serial), with a specific focus on UDP multi-port handling.

## System Architecture Diagram

```mermaid
graph TD
    subgraph GCS_Frontend [Frontend UI - HTML/JS/Electron]
        UI[GCS Dashboard]
        Map[Mission Map]
        CommPanel[Communication Setup Panel]
        WSC[WebSocket Client]
        
        UI <--> WSC
        Map <--> WSC
        CommPanel --> WSC
    end

    subgraph GCS_Backend [Backend Server - C++]
        WSS[WebSocket Server]
        WSC <-->|JSON Commands & Telemetry| WSS
        
        VM[Vehicle Manager]
        WSS <--> VM
        
        subgraph MAVLink_Layer [MAVLink Routing & Parsing]
            Router[Message Router]
            Parser[MAVLink Parser]
        end
        VM <--> Router
        Router <--> Parser

        subgraph Network_Serial_Interfaces [Connection Interfaces]
            TCP[TCP Client Handlers]
            UDP[UDP Server Listeners]
            Serial[Serial COM Handlers]
        end
        Parser <--> TCP
        Parser <--> UDP
        Parser <--> Serial
    end

    subgraph Connected_Vehicles [Multiple Drones/SITL Instances]
        V1[Vehicle 1 SITL]
        V2[Vehicle 2 SITL]
        V3[Vehicle 3 Hardware]
        V4[Vehicle 4 Hardware]
        V5[Vehicle 5 Hardware]
    end

    %% Connection Mappings
    TCP <-->|TCP Connect to 127.0.0.1:5760| V1
    TCP <-->|TCP Connect to 127.0.0.1:5770| V2
    
    UDP <-->|Passive Listen on UDP: 14550| V3
    UDP <-->|Passive Listen on UDP: 14560| V4
    
    Serial <-->|COM3 @ 57600 baud| V5
    
    classDef frontend fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef backend fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef interface fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef vehicle fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    
    class UI,Map,CommPanel,WSC frontend
    class WSS,VM,Router,Parser backend
    class TCP,UDP,Serial interface
    class V1,V2,V3,V4,V5 vehicle
```

---

## 1. How Vehicles are Connected (General)

The GCS acts as a central hub capable of spawning multiple distinct communication channels simultaneously. The backend (`VehicleManager` in C++) maintains a registry of active connections.

1. **Connection Request:** The user specifies a connection type (TCP, UDP, Serial) and target (IP:Port, Local Port, or COM Port) in the UI.
2. **Socket Initialization:** The backend spawns a dedicated socket or serial handler for that specific connection.
3. **MAVLink Parsing:** As bytes stream in from these interfaces, they are parsed into complete MAVLink messages (like `HEARTBEAT`).
4. **Vehicle Instantiation:** Upon receiving a valid MAVLink heartbeat on a new interface, the `VehicleManager` creates a distinct `Vehicle` instance in memory.
5. **UI Synchronization (ui_sysid):** To prevent collisions (e.g., when two SITL drones have the same internal MAVLink `sysid`), the backend assigns a unique `ui_sysid` tied to the specific connection channel. The frontend uses this `ui_sysid` to route commands to the correct drone.

---

## 2. Deep Dive: UDP Connections and Port Control

Unlike TCP (where the GCS actively connects to a drone's server) or Serial (where a direct physical link is established), UDP relies on datagrams and requires a slightly different approach for multi-vehicle control.

### How UDP Listening Works
In the TiHANFly GCS, the UDP interface is configured for **passive listening** on user-defined ports.

```mermaid
sequenceDiagram
    participant UI as GCS UI
    participant UDP as Backend UDP Listener
    participant Drone3 as Vehicle 3 (Port 14550)
    participant Drone4 as Vehicle 4 (Port 14560)

    UI->>UDP: Bind Socket to UDP 14550
    UI->>UDP: Bind Socket to UDP 14560
    
    Note over UDP: GCS is now passively listening<br/>on ports 14550 and 14560
    
    Drone3->>UDP: Send Telemetry to GCS_IP:14550
    UDP->>UDP: Register sender IP & Port for Drone 3
    
    Drone4->>UDP: Send Telemetry to GCS_IP:14560
    UDP->>UDP: Register sender IP & Port for Drone 4
    
    Note over UDP: GCS now knows where to send commands back
    
    UDP->>Drone3: Route Command via Socket 14550 to Drone 3 IP/Port
    UDP->>Drone4: Route Command via Socket 14560 to Drone 4 IP/Port
```

### Key Mechanisms for UDP Multi-Drone Control:

1. **Multiple Bindings:** Instead of a single UDP listener, the C++ backend opens a separate UDP socket bound to a distinct local port for each vehicle (e.g., Socket A on `14550`, Socket B on `14560`).
2. **Sender Identification (Endpoint Caching):** Because UDP is connectionless, the GCS initially only *listens*. When the drone starts transmitting telemetry to the GCS's port, the backend captures the **Sender IP and Source Port** from the incoming UDP packet header.
3. **Bidirectional Control:** Once the sender's endpoint is cached, the GCS uses that specific IP and port combination to send MAVLink command packets (like ARM, TAKEOFF, or Set Flight Mode) back through the same socket.
4. **Isolation:** Because Drone 1 communicates exclusively through the socket bound to `14550` and Drone 2 through `14560`, their data streams never collide. The `VehicleManager` maps Socket A strictly to Vehicle 1, ensuring commands triggered in the UI for Drone 1 are physically routed only to Socket A.
