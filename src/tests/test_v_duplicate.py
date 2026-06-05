from views import remove_duplicates

def test_remove_duplicates():
    points = [
        {"x": 1, "y": 2, "rgb": "red"},
        {"x": 1, "y": 2, "rgb": "red"},
        {"x": 2, "y": 3, "rgb": "blue"},
    ]
    result = remove_duplicates(points)
    assert len(result) == 2
