# JSON Explorer

A lightweight, web-based JSON explorer that transforms raw JSON data into interactive, searchable, and filterable tables. It operates entirely in the browser with no backend setup required.

## Features

- **File & Paste Support**: Load JSON by uploading a `.json` or `.txt` file, or by pasting raw JSON text.
- **Auto-Discovery**: Automatically identifies the record array in your JSON and discovers nested fields.
- **Interactive Tables**:
  - **Pagination**: Navigate through large datasets with adjustable page sizes.
  - **Global Search**: Search across all fields marked as searchable.
  - **Field Filtering**: Apply dedicated filters based on data types (text contains, multi-select chips, number ranges, and booleans).
  - **Sorting**: Sort table columns in ascending or descending order.
- **Customizable View**:
  - **Column Visibility**: Choose which fields to display in the results table.
  - **Field Configuration**: Manually toggle which fields are searchable, filterable, or visible.
- **Record Inspection**: Click any row to view the full raw JSON record in a popover.
- **Dark & Light Modes**: Supports system preferences and manual toggling with local storage persistence.

## How It Works

### 1. Data Loading
The application accepts JSON input and intelligently determines the best array to use as "records." If multiple arrays are found, it prompts the user to pick one.

### 2. Field Discovery
`app.js` performs a deep scan of the dataset to:
- Map out all available paths (including nested objects and arrays).
- Determine data types (string, number, boolean, list, etc.).
- Identify distinct values for fields with low cardinality to enable chip-based filtering.

### 3. State Management
The application maintains a central `state` object that tracks:
- Raw records and discovered field definitions.
- Current search query and active filters.
- Sorting configuration and pagination state.
- A filtered cache to optimize rendering performance.

### 4. Rendering
- **Table**: Renders a dynamic table based on `state.fieldConfig` and `state.filteredCache`.
- **Filters**: Generates a UI for filtering based on the discovered data types of each field.
- **Theming**: Uses CSS variables and a `data-theme` attribute on the `<html>` element for seamless switching between light and dark modes.

## Technical Details

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, and CSS3.
- **No Dependencies**: Built without external libraries or frameworks for maximum portability and speed.
- **Responsive Design**: Optimized for both desktop and mobile viewing with a mobile-friendly field configuration and pagination.

## Usage

Simply open `index.html` in any modern web browser to start exploring your JSON data.
