import json, random

athletes = ["AF", "RR", "JC", "MA", "TL", "CC", "SK", "AS", "HM", "TD"]
sessions = ["Lower A", "Lower B", "Upper A", "Upper B"]

lower_a = [
    ("Trap Bar Deadlift", False), ("Barbell Back Squat", False),
    ("Romanian Deadlift", False), ("Leg Press", False),
    ("Nordic Curl", False), ("Calf Raise", False),
]
lower_b = [
    ("Barbell Back Squat", False), ("Bulgarian Split Squat", False),
    ("Trap Bar Deadlift", False), ("Leg Curl", False),
    ("GHD Hold", True), ("Hip Thrust", False),
]
upper_a = [
    ("Bench Press", False), ("Bench Pull", False), ("Chin Up", False),
    ("Dumbbell Row", False), ("Shoulder Press", False), ("Biceps Curl", False),
]
upper_b = [
    ("Incline Bench Press", False), ("Bent Over Row", False), ("Lat Pulldown", False),
    ("Cable Row", False), ("Tricep Pushdown", False), ("Face Pull", False),
]

exercise_map = {
    "Lower A": lower_a, "Lower B": lower_b,
    "Upper A": upper_a, "Upper B": upper_b,
}

base_loads = {
    "AF": {"squat": 100, "dead": 120, "press": 72, "row": 65, "aux": 45},
    "RR": {"squat": 108, "dead": 130, "press": 75, "row": 65, "aux": 47},
    "JC": {"squat": 105, "dead": 127, "press": 78, "row": 67, "aux": 50},
    "MA": {"squat": 100, "dead": 122, "press": 68, "row": 57, "aux": 42},
    "TL": {"squat": 125, "dead": 147, "press": 90, "row": 73, "aux": 55},
    "CC": {"squat": 97, "dead": 120, "press": 73, "row": 62, "aux": 45},
    "SK": {"squat": 112, "dead": 132, "press": 80, "row": 65, "aux": 50},
    "AS": {"squat": 100, "dead": 122, "press": 70, "row": 62, "aux": 47},
    "HM": {"squat": 115, "dead": 135, "press": 80, "row": 65, "aux": 50},
    "TD": {"squat": 107, "dead": 127, "press": 67, "row": 62, "aux": 47},
}

def get_load(athlete, exercise, week):
    b = base_loads[athlete]
    prog = 1 + (week - 1) * 0.025
    ex = exercise.lower()
    if "squat" in ex or "split" in ex: base = b["squat"]
    elif "deadlift" in ex or "trap" in ex: base = b["dead"]
    elif "press" in ex or "bench" in ex: base = b["press"]
    elif "row" in ex or "pull" in ex or "pulldown" in ex: base = b["row"]
    else: base = b["aux"]
    raw = base * prog
    return round(raw / 2.5) * 2.5

records = []
random.seed(42)

athlete_day_offsets = {
    "AF": [0, 1, 3, 4], "RR": [0, 1, 3, 4], "JC": [0, 1, 3, 4],
    "MA": [0, 1, 3, 4], "TL": [1, 2, 3, 4], "CC": [1, 2, 3, 4],
    "SK": [1, 2, 3, 4], "AS": [1, 2, 3, 4], "HM": [1, 2, 3, 4],
    "TD": [0, 1, 3, 4],
}
athlete_times = {
    "AF": ["06:15", "14:05", "08:05", "15:10"],
    "RR": ["07:10", "08:15", "06:00", "08:05"],
    "JC": ["06:20", "15:05", "14:00", "14:05"],
    "MA": ["06:10", "08:30", "15:15", "16:05"],
    "TL": ["14:22", "15:20", "07:30", "07:30"],
    "CC": ["08:10", "14:15", "08:15", "16:10"],
    "SK": ["15:10", "15:22", "15:20", "15:15"],
    "AS": ["14:05", "14:00", "14:05", "14:00"],
    "HM": ["15:00", "15:00", "15:10", "15:00"],
    "TD": ["08:00", "08:00", "08:30", "08:05"],
}

session_order = ["Lower A", "Upper A", "Lower B", "Upper B"]

from datetime import datetime, timedelta

for week_num, week_start_str in [(6, "2026-05-18"), (7, "2026-05-25"), (8, "2026-06-01")]:
    week_start = datetime.strptime(week_start_str, "%Y-%m-%d")
    for athlete in athletes:
        days = athlete_day_offsets[athlete]
        times = athlete_times[athlete]
        for i, (day_offset, time_str, session_type) in enumerate(zip(days, times, session_order)):
            session_date = week_start + timedelta(days=day_offset)
            ts = f"{session_date.strftime('%Y-%m-%d')}T{time_str}:00"
            exercises = exercise_map[session_type]
            for ex_name, is_time_based in exercises:
                load = get_load(athlete, ex_name, week_num)
                if is_time_based or ex_name in ["Nordic Curl", "Chin Up"]:
                    load = 0
                    reps_val = str(random.randint(25 if is_time_based else 6, 50 if is_time_based else 10))
                else:
                    reps_val = str(random.randint(4, 8))
                for set_num in range(1, 4):
                    set_load = load if set_num < 3 else max(0, load - 2.5)
                    records.append({
                        "timestamp": ts,
                        "athlete": athlete,
                        "session_type": session_type,
                        "exercise": ex_name,
                        "set_number": str(set_num),
                        "reps": reps_val,
                        "load": str(set_load),
                        "rpe": random.randint(5, 9)
                    })

print(f"Generated {len(records)} records")
with open("/tmp/remaining_data.json", "w") as f:
    json.dump(records, f)
print("Written to /tmp/remaining_data.json")
