"""
parse_ardupilot_params.py
Parses the official ArduPilot apm.pdef.xml (ArduCopter) and generates
param_metadata.json ready to be loaded by param-full.js.

Usage:
    python parse_ardupilot_params.py [path-to-apm.pdef.xml]

If no argument is given it will try to fetch the file from autotest.ardupilot.org.
Output: param_metadata.json  (written to the same directory as this script)
"""

import sys
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
import os

XML_URL = "https://autotest.ardupilot.org/Parameters/ArduCopter/apm.pdef.xml"
OUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "param_metadata.json")


def fetch_xml(path_or_url):
    if path_or_url.startswith("http"):
        print(f"Fetching {path_or_url} ...")
        with urllib.request.urlopen(path_or_url, timeout=30) as r:
            return r.read()
    else:
        with open(path_or_url, "rb") as f:
            return f.read()


def parse(xml_bytes):
    root = ET.fromstring(xml_bytes)
    meta = {}

    # Walk all <param> elements regardless of nesting
    for param_el in root.iter("param"):
        raw_name = param_el.get("name", "")
        # Strip vehicle prefix e.g. "ArduCopter:FLTMODE1" → "FLTMODE1"
        name = raw_name.split(":")[-1].strip()
        if not name:
            continue

        doc  = (param_el.get("documentation") or "").strip()
        human = (param_el.get("humanName") or "").strip()
        user  = (param_el.get("user") or "").strip()

        # Full description = humanName + documentation
        description = doc if doc else human

        units     = ""
        unit_text = ""
        range_str = ""
        increment = ""
        options   = []   # list of {"code": ..., "label": ...}
        bitmask   = []   # list of {"bit": ..., "label": ...}
        reboot_req = False

        # <field> children
        for field in param_el.findall("field"):
            fname = (field.get("name") or "").strip()
            fval  = (field.text or "").strip()
            if fname == "Units":
                units = fval
            elif fname == "UnitText":
                unit_text = fval
            elif fname == "Range":
                # "0 10" → "0 - 10"
                parts = fval.split()
                range_str = f"{parts[0]} - {parts[1]}" if len(parts) == 2 else fval
            elif fname == "Increment":
                increment = fval
            elif fname == "RebootRequired":
                reboot_req = fval.lower() in ("true", "1", "yes")

        # <values> → dropdown options
        for val_el in param_el.findall("values/value"):
            code  = val_el.get("code", "")
            label = (val_el.text or "").strip()
            options.append({"code": code, "label": label})

        # <bitmask> → bitmask bits
        for bit_el in param_el.findall("bitmask/bit"):
            bit_num = bit_el.get("code", "")
            label   = (bit_el.text or "").strip()
            bitmask.append({"bit": bit_num, "label": label})

        # Build range display string from options if no explicit range
        if not range_str and options:
            range_str = ",".join(f"{o['code']}:{o['label']}" for o in options)

        entry = {
            "d": description,
            "u": units,
            "ut": unit_text,
            "r": range_str,
            "inc": increment,
            "reboot": reboot_req,
        }
        if options:
            entry["options"] = options
        if bitmask:
            entry["bitmask"] = bitmask
            entry["isBitmask"] = True

        meta[name] = entry

    return meta


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else XML_URL
    xml_bytes = fetch_xml(src)
    meta = parse(xml_bytes)
    print(f"Parsed {len(meta)} parameters.")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"Written → {OUT_FILE}")


if __name__ == "__main__":
    main()
