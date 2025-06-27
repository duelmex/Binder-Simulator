Trading Card Binder Simulator
This application allows you to organize and manage your trading card collection in a virtual binder. You can select different layouts, add cards from various sources, sort them, and manage your binder's capacity.

Features
Customizable Layouts: Choose between 2x2, 3x3, and 4x4 binder page layouts.

Search Integration: Search for Pokémon cards using the pokemontcg.io API and easily add them to your binder. (English cards only)

Drag & Drop Support: Add cards by dragging images from your search results, local files, or directly from URLs.

Card Management: Move, swap, and delete cards within your binder.

Sorting Options: Sort your cards by hue (row-wise or column-wise) for aesthetic organization.

Binder Capacity Control: Add new pages or set a specific total capacity for your binder.

Pagination: Navigate through multiple pages of your binder.

Import/Export: Save and load your binder collection as a JSON file.

PriceCharting CSV Import: Populate your binder quickly from a PriceCharting CSV export. (Non-English cards will return placeholders, but you can manually drag their images into place)

Undo: Revert actions for easy corrections.

Dark Mode: Toggle between light and dark themes for comfortable viewing.

Getting Started
Open the Application: Simply open the binder.html file in your web browser.

Select a Binder Layout: Select a binder layout (2x2, 3x3, or 4x4) from the "Binder Layout" section. The application will automatically initialize with the first layout if no saved state is found.


Adding Cards
1. From Search Results (Pokémon TCG API)
Search: Type a Pokémon card name (e.g., "Charizard," "Pikachu VMAX") into the Search bar.

Select Card: As you type, a dropdown will appear with search results. Click on any card in the dropdown to select it.

A preview image of the selected card will appear below the search bar, which you can drag.

The "Add to Next Empty Slot" button will become active.

Add to Binder:

Drag & Drop: Click and drag the preview image (or any image from the search results dropdown) directly into any empty slot in your binder.

Add to Next Empty Slot Button: Click the "Add to Next Empty Slot" button to automatically place the selected card into the next available empty slot in your binder.

2. From Local Files (Drag & Drop)
You can directly drag an image file from your computer's file explorer and drop it onto any empty card slot (or the binder container generally) to add it to your collection.

3. From External Image URLs (Drag & Drop)
Drag an image directly from another website (e.g., Google Images) or copy an image URL and drag it into a slot in your binder.

Managing Cards in the Binder
Moving/Swapping Cards:

Click and drag a card from an occupied slot in your binder.

Drop it onto another occupied slot to swap their positions.

Drop it onto an empty slot to move it there.

Deleting Cards: Each card in a slot will have a small "X" button in the top-right corner. Click this button to remove the card from that slot.

Sorting:

Sort by Hue (Rows): Click this button to sort all cards in your binder by their dominant color (hue) in a row-major order. Empty slots will retain their relative positions.

Sort by Hue (Columns): Click this button to sort all cards by hue, arranging them to appear in column-wise order within your binder grid. Empty slots will retain their relative positions.

Binder Management
Add Page: Increases your binder's total capacity by adding one full page of empty slots (based on your selected layout).

Set Capacity: Enter a number into the "Total Slots" input field and click "Set Capacity" to manually set the total number of slots in your binder.

If you reduce the capacity below the number of cards you have, you will be prompted for confirmation before cards are removed.

Pagination: Use the "<<" (First Page), "<" (Previous Page), ">" (Next Page), and ">>" (Last Page) buttons to navigate through your binder pages.

Cards Tracker: Keeps track of how many slots are used out of the total available slots (e.g., "Cards: 5 / 9 slots used").

Data Management
Export Binder: Saves your entire binder collection (all cards, their data, and your current layout/page) into a JSON file, which you can download.

Import Binder: Allows you to load a previously exported JSON binder file, restoring your collection.

Import PriceCharting CSV: This powerful feature allows you to import a CSV file directly from PriceCharting. The application will attempt to find matching card images and details from the Pokémon TCG API for each entry in your CSV and add them to your binder.

Note: This process can take time for large files as it fetches data for each card. Japanese cards will typically be imported as placeholders.

A progress bar and a "Cancel Import" button will appear during this process.

Undo: Reverts the last action performed in the application.

Clear All: Empties your entire binder. You will be asked for confirmation before proceeding.

Dark Mode
Click the "Toggle Dark Mode" button to switch between the light and dark themes of the application. Your preference will be saved for future sessions.
