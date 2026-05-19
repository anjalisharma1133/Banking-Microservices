package com.banking.transaction.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "transactions")
@Data
public class Transaction {

    @Id
    private String id;

    @PrePersist
    public void ensureId() {
        if (this.id == null) {
            this.id = java.util.UUID.randomUUID().toString();
        }
    }

    @Column(name = "from_account", nullable = false)
    private String from;

    @Column(name = "to_account", nullable = false)
    private String to;

    @Column(nullable = false)
    private Double amount;

    private String description;

    @Column(nullable = false)
    private String initiatorUid;

    @Column(nullable = false)
    private LocalDateTime timestamp = LocalDateTime.now();

    @Column(nullable = false)
    private String status = "completed";

    @Column(nullable = false)
    private String type = "transfer";
}
