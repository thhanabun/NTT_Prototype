"""Interactive staff setup; passwords stay out of arguments, files and output."""
import argparse
import getpass
import json
from pathlib import Path
import re
import sys

import boto3
from botocore.exceptions import ClientError


def main():
    parser = argparse.ArgumentParser(description="Set your FAST cloud staff password interactively")
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", args.email):
        raise SystemExit("Supply your staff email address")
    root = Path(__file__).resolve().parent.parent
    outputs = json.loads((root / "data/cloud-outputs.json").read_text(encoding="utf-8-sig"))
    session = boto3.Session(profile_name=outputs.get("Profile") or None, region_name=outputs["Region"])
    if session.client("sts").get_caller_identity()["Account"] != outputs["AccountId"]:
        raise SystemExit("AWS account does not match this FAST deployment")
    client = session.client("cognito-idp")
    pool = outputs["UserPoolId"]
    if not sys.stdin.isatty():
        raise SystemExit("Run this script in your interactive terminal")
    print(f"FAST staff: {args.email} / account {outputs['AccountId']} / {outputs['Region']}")
    password = getpass.getpass("New staff password (12+ characters, upper/lowercase, number, symbol): ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match; nothing changed")
    if len(password) < 12 or not all(re.search(pattern, password) for pattern in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9\s]")):
        raise SystemExit("Password does not meet the policy; nothing changed")
    try:
        user = client.admin_get_user(UserPoolId=pool, Username=args.email)
        username = user["Username"]
    except client.exceptions.UserNotFoundException:
        result = client.admin_create_user(UserPoolId=pool, Username=args.email, MessageAction="SUPPRESS",
                                         UserAttributes=[{"Name": "email", "Value": args.email}])
        username = result["User"]["Username"]
    client.admin_set_user_password(UserPoolId=pool, Username=username, Password=password, Permanent=True)
    client.admin_add_user_to_group(UserPoolId=pool, Username=username, GroupName="STAFF")
    print("Staff account ready. Sign in at " + outputs["WebUrl"] + "/admin")


if __name__ == "__main__":
    try:
        main()
    except ClientError as error:
        raise SystemExit(error.response.get("Error", {}).get("Message", "AWS staff setup failed")) from None
