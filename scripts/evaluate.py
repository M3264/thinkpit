#!/usr/bin/env python3
"""Run eight fictional decisions against a single-participant baseline.

Outputs are observations for human review, never an automatic usefulness claim.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

SCENARIOS = [
    ("library", "A fictional library has six volunteers and two extra opening hours available each weekend. Should it extend Saturday, Sunday, or offer a monthly evening event?"),
    ("launch", "A fictional two-person product team can either launch a basic task app in two weeks or spend six weeks adding integrations. They have ten interested testers and no paying customers. Decide on an experiment."),
    ("architecture", "A fictional startup with 300 daily users needs background reminders. Compare a database job table and a separate message broker for a two-person engineering team."),
    ("pricing", "A fictional note-taking app has 200 weekly users and no revenue. Compare a small flat subscription and usage billing. What evidence would change the decision?"),
    ("community", "A fictional neighborhood club has 40 members and a small event budget. Compare an open monthly meetup and a quarterly workshop. Consider access and volunteer workload."),
    ("learning", "A fictional learner has five hours per week for eight weeks to learn a new programming language. Compare building one project and following a course. Propose a feedback loop."),
    ("migration", "A fictional team has a slow legacy API and six clients. Compare replacing it at once and a gradual migration, considering rollback and maintenance work."),
    ("design", "A fictional booking website loses visitors at a five-field registration form. Compare removing registration and simplifying the form. Suggest a measurable trial without inventing data."),
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="examples/pollinations.json")
    parser.add_argument("--binary", default="bin/thinkpit")
    parser.add_argument("--out", default="data/evaluation")
    args = parser.parse_args()
    base = json.loads(Path(args.config).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, topic in SCENARIOS:
        for mode in ("single", "conversation"):
            config = dict(base)
            config["topic"] = topic + " Keep each reply under 100 words. Distinguish evidence from assumptions."
            config["ask_questions"] = False
            selected = base["participants"][:1] if mode == "single" else base["participants"]
            config["participants"] = [{k: v for k, v in participant.items() if k != "instructions"} for participant in selected]
            config["limits"] = dict(base["limits"], max_turns=len(config["participants"]))
            target = out / f"{name}-{mode}.json"
            config_file = out / f"{name}-{mode}-config.json"
            config_file.write_text(json.dumps(config, indent=2))
            started = time.monotonic()
            with (out / f"{name}-{mode}.log").open("w") as log:
                try:
                    result = subprocess.run([args.binary, "run", "-config", str(config_file), "-out", str(target)], stdout=log, stderr=subprocess.STDOUT, timeout=400)
                    code = result.returncode
                except subprocess.TimeoutExpired:
                    code = 124
            transcript = json.loads(target.read_text()) if target.exists() else {}
            row = {"scenario": name, "mode": mode, "exit_code": code, "seconds": round(time.monotonic()-started, 2), "state": transcript.get("state"), "reason": transcript.get("reason"), "completed_turns": sum(a["status"] == "complete" for a in transcript.get("attempts", [])), "charged_tokens": transcript.get("charged_tokens"), "errors": [a.get("error") for a in transcript.get("attempts", []) if a.get("error")]}
            rows.append(row)
            (out / "results.json").write_text(json.dumps(rows, indent=2))
            print(json.dumps(row), flush=True)
    print("Review transcript pairs for responsiveness, useful disagreement, unsupported claims, and decision usefulness.")

if __name__ == "__main__":
    main()
