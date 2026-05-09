local ls = require("luasnip")
local s = ls.snippet
local i = ls.insert_node
local t = ls.text_node
local fmt = require("luasnip.extras.fmt").fmt

local function dep(trigger, desc)
  return s({ trig = trigger, dscr = desc }, fmt(trigger .. " '{}'", { i(1, "group:artifact:version") }))
end

return {
  dep("implementation", "Gradle: implementation dependency"),
  dep("testImplementation", "Gradle: testImplementation dependency"),
  dep("runtimeOnly", "Gradle: runtimeOnly dependency"),
  dep("testRuntimeOnly", "Gradle: testRuntimeOnly dependency"),
  dep("compileOnly", "Gradle: compileOnly dependency"),
  dep("compileOnlyApi", "Gradle: compileOnlyApi dependency"),
  dep("api", "Gradle: api dependency (java-library plugin)"),
  dep("annotationProcessor", "Gradle: annotationProcessor dependency"),
  dep("testAnnotationProcessor", "Gradle: testAnnotationProcessor dependency"),
  dep("developmentOnly", "Gradle: developmentOnly dependency (Spring Boot)"),

  s(
    { trig = "deps", dscr = "Gradle: dependencies block" },
    fmt(
      [[
dependencies {{
    {}
}}
]],
      { i(1) }
    )
  ),

  s(
    { trig = "repos", dscr = "Gradle: repositories with mavenCentral" },
    t({ "repositories {", "\tmavenCentral()", "}" })
  ),

  s(
    { trig = "plugin", dscr = "Gradle: plugin id" },
    fmt("id '{}' version '{}'", { i(1, "org.springframework.boot"), i(2, "3.2.0") })
  ),
}
