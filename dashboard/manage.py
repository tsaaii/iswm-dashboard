"""Make a password hash for DASHBOARD_USERS.

    python -m dashboard.manage hash
"""
import getpass
import sys

from .auth import hash_password, password_problem


def main(argv):
    if argv[:1] != ["hash"]:
        print(__doc__)
        return 1
    name = input("User name: ").strip()
    pw = getpass.getpass("Password: ")
    problem = password_problem(pw)
    if problem:
        print(problem)
        return 1
    if getpass.getpass("Password again: ") != pw:
        print("The two passwords are not the same.")
        return 1
    print("\nAdd this to DASHBOARD_USERS (add @site-a|site-b at the end to limit the sites):\n")
    print("%s:%s" % (name, hash_password(pw)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
