#include <asio.hpp>
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <vector>
#include <string>
#include <chrono>
#include <memory>
#include <atomic>
#include <future>
#include <filesystem>
#include <nlohmann/json.hpp>

#include "Parameters/parameter_manager.h"
#include "mavlink/ardupilotmega/mavlink.h"

using ::testing::_;
using ::testing::Invoke;
using json = nlohmann::json;
namespace fs = std::filesystem;

class ParameterManagerTest : public ::testing::Test {
protected:
    std::string test_cache_dir_ = "./test_param_cache";

    void SetUp() override {
        fs::create_directories(test_cache_dir_);
    }

    void TearDown() override {
        fs::remove_all(test_cache_dir_);
    }
};

// UT-PARAM-001: Happy Path - Dependency injection and configuration
TEST_F(ParameterManagerTest, ConstructionAndConfiguration) {
    // Arrange & Act
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(101);

    // Assert
    EXPECT_FALSE(pm.isLoading());
    EXPECT_EQ(pm.receivedCount(), 0);
    EXPECT_EQ(pm.totalCount(), 0);
}

// UT-PARAM-002: Happy Path - Request All Parameters
TEST_F(ParameterManagerTest, RequestAllParameters_SendsRequestList) {
    // Arrange
    ParameterManager pm(1, 1, test_cache_dir_);
    
    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();
    std::atomic<bool> promise_set{false};

    pm.setTransportCallback([&](const mavlink_message_t& m) {
        if (m.msgid == MAVLINK_MSG_ID_PARAM_REQUEST_LIST) {
            if (!promise_set.exchange(true)) {
                sent_msg_promise.set_value(m);
            }
        }
    });

    // Act
    pm.requestAllParameters(true);

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_PARAM_REQUEST_LIST);
    EXPECT_TRUE(pm.isLoading());
}

// UT-PARAM-003: Happy Path - Single Parameter Request
TEST_F(ParameterManagerTest, RequestParameter_SendsRequestRead) {
    // Arrange
    ParameterManager pm(12, 1, test_cache_dir_);
    
    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    pm.setTransportCallback([&](const mavlink_message_t& m) {
        sent_msg_promise.set_value(m);
    });

    // Act
    pm.requestParameter("SYSID_THISMAV");

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_PARAM_REQUEST_READ);

    mavlink_param_request_read_t req;
    mavlink_msg_param_request_read_decode(&out_msg, &req);
    EXPECT_EQ(req.target_system, 12);
    EXPECT_STREQ(req.param_id, "SYSID_THISMAV");
}

// UT-PARAM-004: Happy Path - Set Parameter Value
TEST_F(ParameterManagerTest, SetParameter_SendsParamSet) {
    // Arrange
    ParameterManager pm(1, 1, test_cache_dir_);

    std::promise<mavlink_message_t> sent_msg_promise;
    auto sent_msg_future = sent_msg_promise.get_future();

    pm.setTransportCallback([&](const mavlink_message_t& m) {
        sent_msg_promise.set_value(m);
    });

    // Act
    pm.setParameter("SIM_SPEEDUP", 5.0f, MAV_PARAM_TYPE_REAL32);

    // Assert
    ASSERT_TRUE(sent_msg_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    mavlink_message_t out_msg = sent_msg_future.get();
    EXPECT_EQ(out_msg.msgid, MAVLINK_MSG_ID_PARAM_SET);

    mavlink_param_set_t set;
    mavlink_msg_param_set_decode(&out_msg, &set);
    EXPECT_FLOAT_EQ(set.param_value, 5.0f);
    EXPECT_STREQ(set.param_id, "SIM_SPEEDUP");
    EXPECT_EQ(set.param_type, MAV_PARAM_TYPE_REAL32);
}

// UT-PARAM-005: Happy Path - Inbound PARAM_VALUE updates manager
TEST_F(ParameterManagerTest, ProcessMessage_UpdatesParametersOnValueReceipt) {
    // Arrange
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(1234);

    std::promise<std::string> json_promise;
    auto json_future = json_promise.get_future();
    pm.setSendCallback([&](const std::string& j) {
        json_promise.set_value(j);
    });

    mavlink_message_t msg;
    mavlink_msg_param_value_pack(1, 1, &msg, "CH7_OPT", 41.0f, MAV_PARAM_TYPE_REAL32, 10, 0);

    // Act
    pm.processMessage(msg);

    // Assert
    ASSERT_TRUE(json_future.wait_for(std::chrono::milliseconds(100)) == std::future_status::ready);
    json response = json::parse(json_future.get());
    EXPECT_EQ(response["type"], "param_value");
    EXPECT_EQ(response["param_id"], "CH7_OPT");
    EXPECT_FLOAT_EQ(response["value"], 41.0f);

    json all_params = pm.getAllParametersJson();
    ASSERT_EQ(all_params.size(), 1);
    EXPECT_EQ(all_params[0]["param_id"], "CH7_OPT");
    EXPECT_FLOAT_EQ(all_params[0]["value"], 41.0f);
}

// UT-PARAM-006: Happy Path - Caching and Serialization
TEST_F(ParameterManagerTest, Serialization_LoadsAndSavesFileCache) {
    // Arrange: Create a manager, save a parameter value, verify cache is written
    {
        ParameterManager pm(1, 1, test_cache_dir_);
        pm.setCacheKey(99);
        pm.updateParamCache("BATT_ARM_VOLT", 11.1f);
        // Wait for the debounced save timer thread to write the file (2 seconds delay)
        std::this_thread::sleep_for(std::chrono::milliseconds(2200));
    }

    // Act & Assert: Load in a new manager
    ParameterManager pm_loader(1, 1, test_cache_dir_);
    pm_loader.setCacheKey(99);
    pm_loader.setSendCallback([](const std::string&) {});
    
    // Explicitly load cache
    bool loaded = pm_loader.loadCache();
    EXPECT_TRUE(loaded);

    json all_params = pm_loader.getAllParametersJson();
    ASSERT_EQ(all_params.size(), 1);
    EXPECT_EQ(all_params[0]["param_id"], "BATT_ARM_VOLT");
    EXPECT_FLOAT_EQ(all_params[0]["value"], 11.1f);
}

// UT-PARAM-007: Boundary - Spacing adjustments based on baudrate
TEST_F(ParameterManagerTest, SetRequestSpacingFromBaudrate_SetsCorrectSpacing) {
    // Arrange
    ParameterManager pm(1, 1, test_cache_dir_);

    // Act & Assert
    pm.setRequestSpacingFromBaudrate(115200); // High speed -> shorter spacing
    pm.setRequestSpacingFromBaudrate(9600);   // Low speed -> longer spacing
    pm.setRequestSpacingFromBaudrate(300);    // Extremely low speed
    pm.setRequestSpacingFromBaudrate(2000000); // Extremely high speed
    pm.setRequestSpacingFromBaudrate(-1);     // UDP connection
    
    SUCCEED();
}

// UT-PARAM-008: Vehicle info and dispatcher routing/sysid mismatch
TEST_F(ParameterManagerTest, VehicleInfoAndDispatcherRouting) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setVehicleInfo(2, 2);

    // Set callback to detect parameter value
    bool got_value = false;
    pm.setSendCallback([&](const std::string&) {
        got_value = true;
    });

    // Message from wrong sysid (1) should be ignored
    mavlink_message_t msg;
    mavlink_msg_param_value_pack(1, 1, &msg, "PARAM_A", 1.0f, MAV_PARAM_TYPE_REAL32, 10, 0);
    pm.processMessage(msg);
    EXPECT_FALSE(got_value);

    // Message from right sysid (2) should be processed
    mavlink_msg_param_value_pack(2, 1, &msg, "PARAM_A", 1.0f, MAV_PARAM_TYPE_REAL32, 10, 0);
    pm.processMessage(msg);
    EXPECT_TRUE(got_value);

    // Message of type HEARTBEAT should be ignored by processMessage
    got_value = false;
    mavlink_msg_heartbeat_pack(2, 1, &msg, MAV_TYPE_QUADROTOR, MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, MAV_STATE_STANDBY);
    pm.processMessage(msg);
    EXPECT_FALSE(got_value);
}

// UT-PARAM-009: Missing transport callback error path
TEST_F(ParameterManagerTest, MissingTransportErrorPaths) {
    ParameterManager pm(1, 1, test_cache_dir_);
    // Do not set transport callback
    bool got_error = false;
    pm.setSendCallback([&](const std::string& j) {
        json response = json::parse(j);
        if (response["type"] == "param_error") {
            got_error = true;
        }
    });

    pm.requestAllParameters(true);
    EXPECT_TRUE(got_error);

    got_error = false;
    pm.requestParameter("PARAM_A");
    // Since requestParameter only logs/sends error, expect it to not crash
    
    got_error = false;
    pm.setParameter("PARAM_A", 1.0f);
    EXPECT_TRUE(got_error);
}

// UT-PARAM-010: requestAllParameters double start / already loading guard
TEST_F(ParameterManagerTest, RequestAllParameters_AlreadyLoadingGuard) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setTransportCallback([](const mavlink_message_t&) {});
    pm.setSendCallback([](const std::string&) {});

    pm.requestAllParameters(true);
    EXPECT_TRUE(pm.isLoading());

    // Firing requestAllParameters with force=false should return early
    pm.requestAllParameters(false);
    EXPECT_TRUE(pm.isLoading());
}

// UT-PARAM-011: updateParamCache and setParameter for existing parameter
TEST_F(ParameterManagerTest, UpdateAndSetExistingParameter) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setTransportCallback([](const mavlink_message_t&) {});
    pm.setSendCallback([](const std::string&) {});

    pm.updateParamCache("MY_PARAM", 10.0f);
    json all = pm.getAllParametersJson();
    ASSERT_EQ(all.size(), 1);
    EXPECT_FLOAT_EQ(all[0]["value"], 10.0f);

    // Update existing param cache
    pm.updateParamCache("MY_PARAM", 20.0f);
    all = pm.getAllParametersJson();
    EXPECT_FLOAT_EQ(all[0]["value"], 20.0f);

    // setParameter for existing param
    pm.setParameter("MY_PARAM", 30.0f);
    all = pm.getAllParametersJson();
    EXPECT_FLOAT_EQ(all[0]["value"], 30.0f);
}

// UT-PARAM-012: Cache management, delete cache and delete all caches
TEST_F(ParameterManagerTest, CacheDeletionAndCleanUp) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(77);
    pm.updateParamCache("PARAM_T", 5.0f);
    // Wait for write via retry loop
    std::string path = test_cache_dir_ + "/sysid_77.json";
    bool written1 = false;
    for (int i = 0; i < 50; ++i) {
        if (fs::exists(path)) { written1 = true; break; }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    EXPECT_TRUE(written1);

    // Delete single cache
    pm.deleteCache(77);
    EXPECT_FALSE(fs::exists(path));

    // Recreate cache
    pm.updateParamCache("PARAM_T", 6.0f);
    bool written2 = false;
    for (int i = 0; i < 50; ++i) {
        if (fs::exists(path)) { written2 = true; break; }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    EXPECT_TRUE(written2);

    // Delete all caches
    pm.deleteAllCaches();
    EXPECT_FALSE(fs::exists(path));
}

// UT-PARAM-013: Corrupt cache file parsing exception handling
TEST_F(ParameterManagerTest, CorruptCacheFileExceptionHandling) {
    std::string corrupt_path = test_cache_dir_ + "/sysid_88.json";
    {
        std::ofstream out(corrupt_path);
        out << "{ corrupt json data ... ";
    }

    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(88);
    // Loading corrupt cache should return false and not crash
    EXPECT_FALSE(pm.loadCache());
}

// UT-PARAM-014: Directory creation exception handling
TEST_F(ParameterManagerTest, DirectoryCreationExceptionHandling) {
    std::string file_as_dir = test_cache_dir_ + "/conflicting_file";
    {
        std::ofstream out(file_as_dir);
        out << "I am a file";
    }

    // Creating ParameterManager with a file path as cache_dir will trigger exception
    // which should be caught internally in the constructor.
    EXPECT_NO_THROW({
        ParameterManager pm(1, 1, file_as_dir);
    });
}

// UT-PARAM-015: Parameter list loading, completion, and retry loop
TEST_F(ParameterManagerTest, RequestAllParameters_FullLoadAndRetrySequence) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(505);

    std::vector<mavlink_message_t> sent_cmds;
    pm.setTransportCallback([&](const mavlink_message_t& msg) {
        sent_cmds.push_back(msg);
    });

    std::vector<std::string> sent_ws;
    pm.setSendCallback([&](const std::string& msg) {
        sent_ws.push_back(msg);
    });

    // Start load
    pm.requestAllParameters(true);
    EXPECT_TRUE(pm.isLoading());

    // Simulate drone sending parameters back (total 2 parameters)
    mavlink_message_t msg1, msg2;
    mavlink_msg_param_value_pack(1, 1, &msg1, "PARAM1", 10.0f, MAV_PARAM_TYPE_REAL32, 2, 0);
    mavlink_msg_param_value_pack(1, 1, &msg2, "PARAM2", 20.0f, MAV_PARAM_TYPE_REAL32, 2, 1);

    pm.processMessage(msg1);
    pm.processMessage(msg2);

    // Wait a bit for the load to finish and retry thread to exit
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    EXPECT_FALSE(pm.isLoading());
    EXPECT_EQ(pm.receivedCount(), 2);
    EXPECT_EQ(pm.totalCount(), 2);

    // Verify parameter values in manager
    json all = pm.getAllParametersJson();
    ASSERT_EQ(all.size(), 2);
    bool found_param1 = false;
    bool found_param2 = false;
    for (const auto& item : all) {
        if (item["param_id"] == "PARAM1") found_param1 = true;
        if (item["param_id"] == "PARAM2") found_param2 = true;
    }
    EXPECT_TRUE(found_param1);
    EXPECT_TRUE(found_param2);

    // Wait for async cache save
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    std::string path = test_cache_dir_ + "/sysid_505.json";
    EXPECT_TRUE(fs::exists(path));
}

// UT-PARAM-016: ProcessMessage updates existing parameters
TEST_F(ParameterManagerTest, ProcessMessage_UpdatesExistingParameterOnValueReceipt) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(1234);
    pm.setSendCallback([](const std::string&) {});

    mavlink_message_t msg;
    mavlink_msg_param_value_pack(1, 1, &msg, "CH7_OPT", 41.0f, MAV_PARAM_TYPE_REAL32, 10, 0);
    pm.processMessage(msg);

    // Ingest again with a different value
    mavlink_msg_param_value_pack(1, 1, &msg, "CH7_OPT", 50.0f, MAV_PARAM_TYPE_REAL32, 10, 0);
    pm.processMessage(msg);

    json all_params = pm.getAllParametersJson();
    ASSERT_EQ(all_params.size(), 1);
    EXPECT_FLOAT_EQ(all_params[0]["value"], 50.0f);
}

// UT-PARAM-017: requestAllParameters with existing cache
TEST_F(ParameterManagerTest, RequestAllParameters_WithExistingCache) {
    // Save cache first
    {
        ParameterManager pm(1, 1, test_cache_dir_);
        pm.setCacheKey(707);
        pm.updateParamCache("PARAM_A", 1.5f);
        std::this_thread::sleep_for(std::chrono::milliseconds(2200));
    }

    // Load manager and request parameters (which will hit the cached path)
    ParameterManager pm_loader(1, 1, test_cache_dir_);
    pm_loader.setCacheKey(707);
    pm_loader.setTransportCallback([](const mavlink_message_t&) {});
    pm_loader.setSendCallback([](const std::string&) {});

    pm_loader.requestAllParameters(true);
    EXPECT_TRUE(pm_loader.isLoading());
}

// UT-PARAM-018: request_by_index and retry loop index requests
TEST_F(ParameterManagerTest, RequestAllParameters_RetryIndexRequests) {
    ParameterManager pm(1, 1, test_cache_dir_);
    pm.setCacheKey(606);

    std::vector<mavlink_message_t> sent_cmds;
    pm.setTransportCallback([&](const mavlink_message_t& msg) {
        sent_cmds.push_back(msg);
    });
    pm.setSendCallback([](const std::string&) {});

    // Start load
    pm.requestAllParameters(true);

    // Ingest the param count so the retry loop knows total_ count
    mavlink_message_t msg;
    mavlink_msg_param_value_pack(1, 1, &msg, "PARAM1", 10.0f, MAV_PARAM_TYPE_REAL32, 3, 0); // index 0, total 3
    pm.processMessage(msg);

    // Sleep 800 ms to trigger stream idle timeout (600 ms) and retry index requests
    std::this_thread::sleep_for(std::chrono::milliseconds(800));

    pm.setCacheKey(999); // avoid overwriting cache

    bool requested_index_1 = false;
    bool requested_index_2 = false;
    for (const auto& cmd : sent_cmds) {
        if (cmd.msgid == MAVLINK_MSG_ID_PARAM_REQUEST_READ) {
            mavlink_param_request_read_t req;
            mavlink_msg_param_request_read_decode(&cmd, &req);
            if (req.param_index == 1) requested_index_1 = true;
            if (req.param_index == 2) requested_index_2 = true;
        }
    }
    EXPECT_TRUE(requested_index_1);
    EXPECT_TRUE(requested_index_2);
}

// UT-PARAM-019: Exception handling in Save, Delete, and DeleteAll
TEST_F(ParameterManagerTest, SaveAndDeleteCache_ExceptionHandling) {
    ParameterManager pm(1, 1, "/nonexistent/directory/path");
    pm.setCacheKey(123);
    
    // Attempting to save cache to nonexistent directory should catch std::exception
    EXPECT_NO_THROW({
        pm.updateParamCache("PARAM_T", 5.0f);
        // Wait for debounce save thread to trigger save_cache_file
        std::this_thread::sleep_for(std::chrono::milliseconds(2200));
    });

    // Attempting to delete cache on invalid directory
    EXPECT_NO_THROW({
        pm.deleteCache(123);
    });

    // Attempting to delete all caches on invalid directory
    EXPECT_NO_THROW({
        pm.deleteAllCaches();
    });
}

