a = {}
a.x = 1
a.y = 2
b = {}
b.x = 1
b.y = 2

print(a ~= b) -- despite having the same values, this will return true as they are different references
