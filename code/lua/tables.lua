a = {}
k = "x"
a[k] = 10
a[1] = "great"
k = "y"
for i, entry in ipairs(a) do
	print(entry)
end
