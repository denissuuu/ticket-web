document.addEventListener('DOMContentLoaded', function() {
    // Éléments du DOM
    const ticketIssuerInput = document.getElementById('ticket-issuer');
    const ticketValueInput = document.getElementById('ticket-value');
    const ticketQuantityInput = document.getElementById('ticket-quantity');
    const ticketDateInput = document.getElementById('ticket-date');
    const addTicketButton = document.getElementById('add-ticket');
    const ticketList = document.getElementById('ticket-list');
    const totalValueElement = document.getElementById('total-value');
    const backgroundColorInput = document.getElementById('background-color');
    const resetColorButton = document.getElementById('reset-color');
    const resetDataButton = document.getElementById('reset-data');
    const detailsContainer = document.getElementById('details-container');
    const detailsTitle = document.getElementById('details-title');
    const detailsContent = document.getElementById('details-content');
    const closeDetailsButton = document.getElementById('close-details');
  
    const defaultBackgroundColor = '#f5f5f5';
    
 
    const today = new Date();
    const formattedDate = today.toISOString().substring(0, 10);
    ticketDateInput.value = formattedDate;
    
    
    const savedBackgroundColor = localStorage.getItem('backgroundColor') || defaultBackgroundColor;
    document.body.style.backgroundColor = savedBackgroundColor;
    backgroundColorInput.value = savedBackgroundColor;
    
    
    let tickets = [];
   
    loadTickets();
    
    
    addTicketButton.addEventListener('click', addTicket);
    
    
    addTicketButton.classList.add('add-button-animation');
    
    
    backgroundColorInput.addEventListener('input', function() {
        const color = this.value;
        document.body.style.backgroundColor = color;
        localStorage.setItem('backgroundColor', color);
    });
    
    
    resetColorButton.addEventListener('click', function() {
        document.body.style.backgroundColor = defaultBackgroundColor;
        backgroundColorInput.value = defaultBackgroundColor;
        localStorage.setItem('backgroundColor', defaultBackgroundColor);
    });
    
    // Ajouter un écouteur d'événement pour fermer les détails
    closeDetailsButton.addEventListener('click', function() {
        detailsContainer.classList.add('hidden');
    });
    
    // Ajouter un écouteur d'événement pour réinitialiser toutes les données
    resetDataButton.addEventListener('click', function() {
        if (confirm('Êtes-vous sûr de vouloir supprimer toutes vos données de tickets ? Cette action est irréversible.')) {
            tickets = [];
            localStorage.removeItem('tickets');
            renderTicketList();
            
            // Animation de confirmation
            resetDataButton.textContent = "Données effacées !";
            resetDataButton.classList.add('animate__animated', 'animate__headShake');
            
            setTimeout(() => {
                resetDataButton.textContent = "Réinitialiser toutes les données";
                resetDataButton.classList.remove('animate__animated', 'animate__headShake');
            }, 2000);
        }
    });
    
    // Ajouter des écouteurs d'événements pour les touches du clavier
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (document.activeElement === ticketIssuerInput || 
                                  document.activeElement === ticketValueInput || 
                                  document.activeElement === ticketQuantityInput ||
                                  document.activeElement === ticketDateInput)) {
            addTicket();
        }
        
        if (e.key === 'Escape' && !detailsContainer.classList.contains('hidden')) {
            detailsContainer.classList.add('hidden');
        }
    });
    
    // Fonction pour formater la date en format français
    function formatDate(dateString) {
        if (!dateString) return "Non spécifiée";
        
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    // Fonction pour ajouter un nouveau ticket
    function addTicket() {
        const name = ticketIssuerInput.value.trim();
        const value = parseFloat(ticketValueInput.value);
        const quantity = parseInt(ticketQuantityInput.value);
        const date = ticketDateInput.value;
        
        // Validation des entrées
        if (name === '' || isNaN(value) || isNaN(quantity) || value <= 0 || quantity <= 0 || !date) {
            shakeElement(ticketIssuerInput.parentElement);
            alert('Veuillez remplir correctement tous les champs.');
            return;
        }
        
        // Créer un nouvel objet ticket
        const ticket = {
            id: Date.now(), // Utiliser un timestamp comme identifiant unique
            name: name,
            value: value,
            quantity: quantity,
            date: date
        };
        
        // Ajouter le ticket au tableau
        tickets.push(ticket);
        
        // Mettre à jour l'affichage
        renderTicketList();
        
        // Enregistrer dans le stockage local
        saveTickets();
        
        // Réinitialiser les champs du formulaire
        ticketIssuerInput.value = '';
        ticketValueInput.value = '';
        ticketQuantityInput.value = '';
        // Garder la date du jour
        ticketDateInput.value = formattedDate;
        
        // Mettre le focus sur le champ nom
        ticketIssuerInput.focus();
    }
    
    // Fonction pour faire trembler un élément (animation d'erreur)
    function shakeElement(element) {
        element.classList.add('animate__animated', 'animate__shakeX');
        
        // Supprimer la classe après l'animation
        setTimeout(() => {
            element.classList.remove('animate__animated', 'animate__shakeX');
        }, 1000);
    }
    
    // Fonction pour supprimer un ticket
    function deleteTicket(id) {
        // Filtrer le ticket à supprimer
        tickets = tickets.filter(ticket => ticket.id !== id);
        
        // Mettre à jour l'affichage
        renderTicketList();
        
        // Enregistrer dans le stockage local
        saveTickets();
    }
    
    // Fonction pour éditer un ticket
    function editTicket(id) {
        const ticket = tickets.find(ticket => ticket.id === id);
        if (!ticket) return;
        
        // Remplir le formulaire avec les valeurs du ticket
        ticketIssuerInput.value = ticket.name;
        ticketValueInput.value = ticket.value;
        ticketQuantityInput.value = ticket.quantity;
        ticketDateInput.value = ticket.date || formattedDate;
        
        // Supprimer le ticket existant
        deleteTicket(id);
        
        // Mettre le focus sur le champ nom
        ticketIssuerInput.focus();
    }
    
    // Fonction pour afficher les détails d'un groupe de tickets
    function showDetails(name) {
        // Filtrer les tickets par nom
        const ticketsOfSameType = tickets.filter(ticket => ticket.name === name);
        
        if (ticketsOfSameType.length === 0) return;
        
        // Mettre à jour le titre
        detailsTitle.textContent = name;
        
        // Vider le contenu précédent
        detailsContent.innerHTML = '';
        
        // Regrouper les tickets par valeur
        const valueGroups = {};
        
        ticketsOfSameType.forEach(ticket => {
            const key = ticket.value.toFixed(2);
            if (!valueGroups[key]) {
                valueGroups[key] = {
                    value: ticket.value,
                    tickets: []
                };
            }
            valueGroups[key].tickets.push(ticket);
        });
        
        // Créer un tableau pour les détails
        const detailsTable = document.createElement('table');
        detailsTable.className = 'details-table';
        
        // Créer l'en-tête du tableau
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Valeur unitaire (€)</th>
                <th>Quantité</th>
                <th>Date</th>
                <th>Valeur totale (€)</th>
                <th>Actions</th>
            </tr>
        `;
        detailsTable.appendChild(thead);
        
        // Créer le corps du tableau
        const tbody = document.createElement('tbody');
        
        // Ajouter une ligne pour chaque ticket
        ticketsOfSameType.forEach(ticket => {
            const row = document.createElement('tr');
            const totalValue = ticket.value * ticket.quantity;
            
            row.innerHTML = `
                <td>${ticket.value.toFixed(2)} €</td>
                <td>${ticket.quantity}</td>
                <td>${formatDate(ticket.date)}</td>
                <td>${totalValue.toFixed(2)} €</td>
                <td>
                    <button class="action-button detail-edit-button" data-id="${ticket.id}">Éditer</button>
                    <button class="action-button detail-delete-button" data-id="${ticket.id}">Supprimer</button>
                </td>
            `;
            
            tbody.appendChild(row);
            
            // Ajouter des écouteurs d'événements aux boutons
            const editButton = row.querySelector('.detail-edit-button');
            const deleteButton = row.querySelector('.detail-delete-button');
            
            editButton.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-id'));
                editTicket(id);
                detailsContainer.classList.add('hidden');
            });
            
            deleteButton.addEventListener('click', function() {
                const id = parseInt(this.getAttribute('data-id'));
                if (confirm(`Êtes-vous sûr de vouloir supprimer ce ticket ?`)) {
                    deleteTicket(id);
                    
                    // Si c'était le dernier ticket de ce type, fermer les détails
                    if (tickets.filter(t => t.name === name).length === 0) {
                        detailsContainer.classList.add('hidden');
                    } else {
                        // Sinon, rafraîchir les détails
                        showDetails(name);
                    }
                }
            });
        });
        
        detailsTable.appendChild(tbody);
        
        // Ajouter le tableau au conteneur de détails
        detailsContent.appendChild(detailsTable);
        
        // Afficher le conteneur de détails
        detailsContainer.classList.remove('hidden');
    }
    
    // Fonction pour afficher les tickets dans le tableau
    function renderTicketList() {
        // Vider la liste
        ticketList.innerHTML = '';
        
        // Variable pour stocker la valeur totale
        let totalValue = 0;
        
        // S'il n'y a pas de tickets, afficher un message
        if (tickets.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `<td colspan="6" class="empty-message">Aucun ticket ajouté. Utilisez le formulaire ci-dessus pour commencer.</td>`;
            ticketList.appendChild(emptyRow);
            totalValueElement.textContent = '0.00 €';
            return;
        }
        
        // Grouper les tickets par nom
        const groupedTickets = {};
        
        tickets.forEach(ticket => {
            const key = ticket.name;
            if (!groupedTickets[key]) {
                groupedTickets[key] = {
                    name: ticket.name,
                    tickets: []
                };
            }
            groupedTickets[key].tickets.push(ticket);
        });
        
        // Parcourir tous les groupes de tickets
        let rowIndex = 0;
        for (const group of Object.values(groupedTickets)) {
            // Calculer les totaux pour ce groupe
            let groupTotalQuantity = 0;
            let groupTotalValue = 0;
            
            group.tickets.forEach(ticket => {
                groupTotalQuantity += ticket.quantity;
                groupTotalValue += ticket.value * ticket.quantity;
            });
            
            // Ajouter à la valeur totale globale
            totalValue += groupTotalValue;
            
            // Vérifier s'il y a différentes valeurs
            const uniqueValues = new Set(group.tickets.map(ticket => ticket.value.toFixed(2)));
            const hasMultipleValues = uniqueValues.size > 1;
            
            // Créer une nouvelle ligne de tableau
            const row = document.createElement('tr');
            row.style.animationDelay = `${rowIndex * 0.1}s`;
            row.classList.add('animate__animated', 'animate__fadeIn');
            
            // Remplir la ligne avec les données du groupe
            row.innerHTML = `
                <td>${group.name}</td>
                <td>${hasMultipleValues ? 'Variable' : group.tickets[0].value.toFixed(2) + ' €'}</td>
                <td>${groupTotalQuantity}</td>
                <td>${group.tickets.length > 1 ? 'Multiple' : formatDate(group.tickets[0].date)}</td>
                <td>${groupTotalValue.toFixed(2)} €</td>
                <td>
                    <button class="details-button" data-name="${group.name}">Détails</button>
                    ${hasMultipleValues ? '' : `
                    <button class="action-button edit-button" data-id="${group.tickets[0].id}">Éditer</button>
                    <button class="action-button delete-button" data-name="${group.name}">Supprimer</button>
                    `}
                </td>
            `;
            
            // Ajouter la ligne au tableau
            ticketList.appendChild(row);
            
            // Ajouter des écouteurs d'événements aux boutons
            const detailsButton = row.querySelector('.details-button');
            detailsButton.addEventListener('click', function() {
                const name = this.getAttribute('data-name');
                showDetails(name);
            });
            
            // Si le groupe n'a qu'une seule valeur, ajouter les écouteurs d'événements pour éditer et supprimer
            if (!hasMultipleValues) {
                const editButton = row.querySelector('.edit-button');
                const deleteButton = row.querySelector('.delete-button');
                
                editButton.addEventListener('click', function() {
                    editTicket(parseInt(this.getAttribute('data-id')));
                });
                
                deleteButton.addEventListener('click', function() {
                    const name = this.getAttribute('data-name');
                    if (confirm(`Êtes-vous sûr de vouloir supprimer tous les tickets "${name}" ?`)) {
                        // Supprimer tous les tickets avec ce nom
                        tickets = tickets.filter(ticket => ticket.name !== name);
                        renderTicketList();
                        saveTickets();
                    }
                });
            }
            
            rowIndex++;
        }
        
        // Mettre à jour la valeur totale
        totalValueElement.textContent = totalValue.toFixed(2) + ' €';
    }
    
    // Fonction pour enregistrer les tickets dans le stockage local
    function saveTickets() {
        localStorage.setItem('tickets', JSON.stringify(tickets));
    }
    
    // Fonction pour charger les tickets depuis le stockage local
    function loadTickets() {
        const storedTickets = localStorage.getItem('tickets');
        if (storedTickets) {
            tickets = JSON.parse(storedTickets);
            renderTicketList();
        } else {
            renderTicketList(); // Pour afficher le message vide
        }
    }
}); 