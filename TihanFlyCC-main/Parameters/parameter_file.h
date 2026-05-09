#pragma once
/**
 * parameter_file.h
 * TiHANFly GCS — Parameter File I/O
 *
 * Reads/writes ArduPilot .param files (the same plain-text format that
 * Mission Planner uses):
 *
 *   # comment line
 *   PARAM_NAME,VALUE
 *   ...
 *
 * These helpers are intentionally free functions so they can be used by
 * ParameterManager without coupling it to filesystem concerns.
 */

#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <iostream>
#include <stdexcept>

using json = nlohmann::json;

struct ParamFileEntry
{
    std::string name;
    float       value = 0.f;
};

// ── Write ──────────────────────────────────────────────────────────────────────
/**
 * Save parameters to an ArduPilot .param file.
 * @param filepath  Destination path (e.g. "params_2025-01-01.param").
 * @param params    JSON array with objects {"name":…, "value":…}.
 * @throws std::runtime_error on I/O failure.
 */
inline void save_param_file(const std::string& filepath, const json& params)
{
    std::ofstream f(filepath);
    if (!f.is_open())
        throw std::runtime_error("Cannot open '" + filepath + "' for writing");

    f << "# TiHANFly GCS — exported parameters\n";

    for (const auto& p : params)
    {
        std::string name  = p.value("name",  "UNKNOWN");
        float       value = p.value("value", 0.f);
        f << name << "," << value << "\n";
    }

    std::cout << "[ParamFile] Saved " << params.size()
              << " parameters to " << filepath << "\n";
}

// ── Read ───────────────────────────────────────────────────────────────────────
/**
 * Load parameters from an ArduPilot .param file.
 * @param filepath  Source path.
 * @return Vector of {name, value} pairs.  Empty on failure (errors logged).
 */
inline std::vector<ParamFileEntry> load_param_file(const std::string& filepath)
{
    std::vector<ParamFileEntry> result;
    std::ifstream f(filepath);

    if (!f.is_open())
    {
        std::cerr << "[ParamFile] Cannot open '" << filepath << "' for reading\n";
        return result;
    }

    std::string line;
    int line_no = 0;
    while (std::getline(f, line))
    {
        ++line_no;

        // Strip leading whitespace
        auto start = line.find_first_not_of(" \t\r\n");
        if (start == std::string::npos) continue;   // blank line
        line = line.substr(start);

        if (line[0] == '#') continue;               // comment

        auto comma = line.find(',');
        if (comma == std::string::npos)
        {
            std::cerr << "[ParamFile] Line " << line_no
                      << ": missing comma — skipped\n";
            continue;
        }

        ParamFileEntry e;
        e.name = line.substr(0, comma);

        try
        {
            e.value = std::stof(line.substr(comma + 1));
        }
        catch (...)
        {
            std::cerr << "[ParamFile] Line " << line_no
                      << ": bad value for '" << e.name << "' — skipped\n";
            continue;
        }

        result.push_back(e);
    }

    std::cout << "[ParamFile] Loaded " << result.size()
              << " parameters from " << filepath << "\n";
    return result;
}