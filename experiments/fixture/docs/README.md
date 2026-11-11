{
  "format": "key/value lines",
  "rules": {
    "line": "one pair per non-empty line; '#' until end of line is a comment",
    "separator": "the first '=' separates key from value; later '=' characters belong to the value",
    "key": "trimmed; empty key is an error",
    "value": "trimmed; an empty value is allowed and means empty string",
    "duplicate": "last value wins; no error",
    "quote": "no quoting syntax: quotes are ordinary characters",
    "escape": "no escape syntax"
  },
  "known-gaps": [
    "no quoting: a value that needs a leading/trailing space cannot be represented",
    "a '#' inside a value is treated as a comment start, so values cannot contain '#'",
    "duplicate handling is silent: callers cannot detect a conflicting configuration"
  ]
}
