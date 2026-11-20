"""Entry handlers. Every handler checks ownership before it touches an entry."""


def require_owner(user, entry):
    if entry["owner"] != user:
        raise PermissionError(f"{user} does not own entry {entry['id']}")


def get_entry(user, entry):
    require_owner(user, entry)
    return entry


def update_entry(user, entry, amount):
    require_owner(user, entry)
    entry["amount"] = amount
    return entry


def delete_entry(user, entry, entries):
    require_owner(user, entry)
    entries.remove(entry)
    return entry
