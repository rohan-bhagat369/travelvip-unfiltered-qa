import json
import re

path = r"C:\Users\Rohan Bhagat\.cursor\projects\d-Travel-VIP-API-Automation\agent-transcripts\9bc7eca4-a955-4cbb-a189-128b67bff52f\9bc7eca4-a955-4cbb-a189-128b67bff52f.jsonl"

with open(path, "r", encoding="utf-8") as f:
    for i, line in enumerate(f, 1):
        if "SG671-DEL-BOM-2026-11-26" in line and '"role":"user"' in line:
            obj = json.loads(line)
            text = obj["message"]["content"][0]["text"]
            for key in ["type", "retryCount", "tripType", "requestStatus", "status", "qtime"]:
                m = re.search(rf'"{key}"\s*:\s*("[^"]*"|\d+|null|true|false)', text)
                if m:
                    print(f"{key}: {m.group(1)}")
            legs = re.findall(r'"legId"\s*:\s*"([^"]+)"', text)
            segs = re.findall(r'"segmentReference"\s*:\s*"([^"]+)"', text)
            print("legIds:", legs[:10])
            print("segmentRefs:", segs[:10])
            # count seats per segment by looking at seatMap arrays roughly
            parts = text.split('"seatMap"')
            print("seatMap blocks:", len(parts) - 1)
            for j, p in enumerate(parts[1:4], 1):
                open_count = p.count('"seatAvailability": "Open"') + p.count('"seatAvailability":"Open"')
                print(f"  block {j} Open seats ~ {open_count}")
            print("line", i)
            print("text_len", len(text))
            # print first 1500 chars after type for header
            idx = text.find('"type"')
            print(text[idx : idx + 800])
            break
