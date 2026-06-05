from flask import Blueprint, render_template, request, jsonify
import json
import database
import os 


views = Blueprint("views", __name__)

@views.route('/save-mask', methods=['POST'])
def save_mask():
    data = request.get_json(silent=True) or {}
    file = (data.get('file') or '').strip()
    mask_id = data.get('maskId')
    polygon = data.get('polygon') or []

    if not file or not isinstance(mask_id, int) or len(polygon) < 2:
        return jsonify(error="file (str), maskId (int), and polygon (>=2 points) are required"), 400

    db = database.get_db()
    row = db.execute('SELECT id FROM images WHERE filename = ?', (file,)).fetchone()
    if row:
        image_id = row['id']
    else:
        cur = db.execute('INSERT INTO images (filename) VALUES (?)', (file,))
        db.commit()
        image_id = cur.lastrowid

    location_data_json = json.dumps([(p.get('x', 0), p.get('y', 0)) for p in polygon])

    db.execute(
        'INSERT INTO masks (celltype, image, location_data) VALUES (?, ?, ?)',
        (mask_id, image_id, location_data_json)
    )
    db.commit()

    return jsonify(ok=True, saved=1), 201

@views.route("/load-masks")
def load_masks():
    db = database.get_db()
    raw_id = (request.args.get('id') or '').strip()
    file = (request.args.get('file') or '').strip()

    if not raw_id or not file:
        return jsonify([])

    # normalize "mask_4" -> 4
    try:
        celltype_id = int(raw_id.replace('mask_', ''))
    except ValueError:
        return jsonify([])

    row = db.execute('SELECT id FROM images WHERE filename = ?', (file,)).fetchone()
    if not row:
        return jsonify([])

    image_id = row['id']
    rows = db.execute(
        'SELECT id, location_data FROM masks WHERE image = ? AND celltype = ?',
        (image_id, celltype_id)
    ).fetchall()

    masks = []
    for row in rows:
        masks.append({
            'id': row['id'],  # Include the mask ID for updates
            'location_data': json.loads(row['location_data'])  # decode JSON string
        })

    return jsonify(masks)


@views.route('/delete-masks', methods=['POST'])
def delete_masks():
    payload = request.get_json(silent=True) or {}
    ids = payload.get('ids') or []
    if isinstance(ids, int):
        ids = [ids]
    try:
        ids = [int(i) for i in ids]
    except Exception:
        return jsonify(ok=False, error='ids must be integers'), 400

    if not ids:
        return jsonify(ok=True, deleted=0), 200

    placeholders = ','.join(['?'] * len(ids))
    db = database.get_db()
    cursor = db.execute(f'DELETE FROM masks WHERE id IN ({placeholders})', ids)
    db.commit()
    return jsonify(ok=True, deleted=cursor.rowcount), 200


@views.route('/update-masks', methods=['POST'])
def update_masks():
    payload = request.get_json(silent=True) or {}
    updates = payload.get('updates') or []
    if not isinstance(updates, list):
        return jsonify(ok=False, error='updates must be a list'), 400

    db = database.get_db()
    updated = 0
    for item in updates:
        try:
            mask_id = int(item.get('id'))
            points = item.get('location_data') or []
            if not isinstance(points, list):
                continue
            # ensure points are in the same format as save-mask: [(x, y), (x, y), ...]
            cleaned = []
            for p in points:
                x = p.get('x') if isinstance(p, dict) else None
                y = p.get('y') if isinstance(p, dict) else None
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    cleaned.append((x, y))  # Use tuple format like save-mask
            location_data_json = json.dumps(cleaned)
            db.execute(
                'UPDATE masks SET location_data = ? WHERE id = ?',
                (location_data_json, mask_id)
            )
            updated += 1
        except Exception:
            continue

    db.commit()
    return jsonify(ok=True, updated=updated), 200

def remove_duplicates(points):
    seen = set()
    unique_points = []
    
    for p in points:
        p_tuple = (p['x'], p['y'], p['rgb'])
        if p_tuple not in seen:
            seen.add(p_tuple)
            unique_points.append(p)
    
    return unique_points


@views.route("/categories", methods=["GET"])
def list_categories():
    db = database.get_db()
    rows = db.execute("SELECT id, name, colour FROM CELLTYPE ORDER BY id ASC").fetchall()
    return jsonify([
        {"id": row["id"], "name": row["name"], "color": row["colour"]}
        for row in rows
    ]), 200


@views.route("/categories", methods=["POST"])
def create_category():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    color = (payload.get("color") or "").strip()
    if not name or not color:
        return jsonify(error="name and color are required"), 400

    db = database.get_db()
    # avoid dup by name
    row = db.execute(
        "SELECT id FROM CELLTYPE WHERE LOWER(name)=LOWER(?)", (name,)
    ).fetchone()
    if row:
        existing = db.execute(
            "SELECT id, name, colour FROM CELLTYPE WHERE id=?", (row["id"],)
        ).fetchone()
        return jsonify({"id": existing["id"], "name": existing["name"], "color": existing["colour"]}), 200

    cur = db.execute(
        "INSERT INTO CELLTYPE (name, colour) VALUES (?, ?)",
        (name, color)
    )
    db.commit()
    new_id = cur.lastrowid
    return jsonify({"id": new_id, "name": name, "color": color}), 201

@views.route("/categories/<int:category_id>", methods=["DELETE"])
def delete_category(category_id):
    db = database.get_db()   
    category = db.execute(
        "SELECT id FROM CELLTYPE WHERE id = ?", (category_id,)
    ).fetchone()
    
    if not category:
        return jsonify(error="Category not found"), 404
    
    try:
        db.execute("DELETE FROM masks WHERE celltype = ?", (category_id,))
        db.execute("DELETE FROM CELLTYPE WHERE id = ?", (category_id,))
        db.commit()
        
        return jsonify({"ok": True, "deleted": category_id}), 200
    except Exception as e:
        return jsonify(error=f"Failed to delete category: {str(e)}"), 500

@views.route("/categories/<int:category_id>", methods=["PUT"])
def update_category(category_id):
    db = database.get_db()
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    color = (payload.get("color") or "").strip()
    
    if not name:
        return jsonify(error="name is required"), 400
    
    # Check if category exists
    category = db.execute(
        "SELECT id FROM CELLTYPE WHERE id = ?", (category_id,)
    ).fetchone()
    
    if not category:
        return jsonify(error="Category not found"), 404
    
    # Check for duplicate name (excluding current category)
    duplicate = db.execute(
        "SELECT id FROM CELLTYPE WHERE LOWER(name) = LOWER(?) AND id != ?",
        (name, category_id)
    ).fetchone()
    
    if duplicate:
        return jsonify(error="A category with this name already exists"), 400
    
    try:
        # Update name and/or color
        if color:
            db.execute(
                "UPDATE CELLTYPE SET name = ?, colour = ? WHERE id = ?",
                (name, color, category_id)
            )
        else:
            db.execute(
                "UPDATE CELLTYPE SET name = ? WHERE id = ?",
                (name, category_id)
            )
        db.commit()
        
        # Fetch updated category
        updated = db.execute(
            "SELECT id, name, colour FROM CELLTYPE WHERE id = ?", (category_id,)
        ).fetchone()
        
        return jsonify({
            "ok": True, 
            "id": updated["id"], 
            "name": updated["name"], 
            "color": updated["colour"]
        }), 200
    except Exception as e:
        return jsonify(error=f"Failed to update category: {str(e)}"), 500

@views.route('/mask-coverage')
def mask_coverage():
    db = database.get_db()
    file = (request.args.get('file') or '').strip()
    if not file:
        return jsonify([])

    row = db.execute('SELECT id FROM images WHERE filename = ?', (file,)).fetchone()
    if not row:
        return jsonify([])

    image_id = row['id']
    rows = db.execute(
        'SELECT celltype AS id, COUNT(*) AS count '
        'FROM masks WHERE image = ? GROUP BY celltype',
        (image_id,)
    ).fetchall()

    return jsonify([{'id': str(r['id']), 'count': r['count']} for r in rows])
