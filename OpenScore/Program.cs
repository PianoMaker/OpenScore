using Microsoft.AspNetCore.StaticFiles;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();

// Map content types for MusicXML
var contentTypeProvider = new FileExtensionContentTypeProvider();
contentTypeProvider.Mappings[".musicxml"] = "application/vnd.recordare.musicxml+xml";
contentTypeProvider.Mappings[".mxl"] = "application/vnd.recordare.musicxml";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypeProvider
});

app.UseRouting();
app.UseAuthorization();
app.MapRazorPages();
app.Run();
