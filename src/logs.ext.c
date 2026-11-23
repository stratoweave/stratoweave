void stratoweaveQ_logsQ___ext_init__() {}

// The Acton side deliberately knows neither the key type nor its witnesses.
// Dictionary items already contain the original boxed keys and values.
B_Iterator stratoweaveQ_logsQ__dict_items(B_value value) {
    return (B_Iterator)$NEW(B_IteratorD_dict_items, (B_dict)value);
}
