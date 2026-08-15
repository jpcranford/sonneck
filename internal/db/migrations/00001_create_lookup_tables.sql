-- +goose Up
CREATE TABLE musical_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE sheet_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

INSERT INTO musical_keys (name) VALUES
    ('C Major'), ('C Minor'),
    ('C# Major'), ('C# Minor'),
    ('D Major'), ('D Minor'),
    ('D# Major'), ('D# Minor'),
    ('E Major'), ('E Minor'),
    ('F Major'), ('F Minor'),
    ('F# Major'), ('F# Minor'),
    ('G Major'), ('G Minor'),
    ('G# Major'), ('G# Minor'),
    ('A Major'), ('A Minor'),
    ('A# Major'), ('A# Minor'),
    ('B Major'), ('B Minor');

INSERT INTO sheet_types (name) VALUES
    ('Lead Sheet'), ('Solo Part'), ('Ensemble Score'), ('PVG Score');

-- +goose Down
DROP TABLE sheet_types;
DROP TABLE musical_keys;
