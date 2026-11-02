"""`app.messaging` bounded context: conversations about an item (ITEM), a
Circle (GROUP), one of its Terms (TERM) or an event (EVENT), their messages,
and each party's read marker. There is no participant table: access is
computed per request from the groups, circulation and events contexts (the
latter through `infrastructure/events_acl.py`)."""
