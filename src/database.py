import sqlite3
from flask import g
from os import path

DB_PATH = "database.db"

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def create_tables():
    db = sqlite3.connect(DB_PATH)
    cursor = db.cursor()

    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL
        )
        '''
    )


    cursor.execute("""
        CREATE TABLE IF NOT EXISTS celltype (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            colour TEXT NOT NULL
        )
    """)


    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS masks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            celltype INTEGER NOT NULL,
            image INTEGER NOT NULL,
            location_data TEXT NOT NULL,
            FOREIGN KEY (image) REFERENCES images(id),
            FOREIGN KEY (celltype) REFERENCES celltype(id)
        )
        '''
    )




    cursor.execute("SELECT COUNT(*) AS c FROM CELLTYPE")
    if cursor.fetchone()[0] == 0:
        defaults = [
            ("Red blood cells", "#DC143C"),
            ("White blood cells", "#FF1493"),
            ("PlasmaTV", "#40E0D0"),
        ]
        cursor.executemany(
            "INSERT INTO CELLTYPE (name, colour) VALUES (?, ?)",
            defaults
        )

    db.commit()
    db.close()