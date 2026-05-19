package com.banking.account.entity;

import jakarta.persistence.*;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import java.util.UUID;

@Entity
@Table(name = "users")
@Data
public class User {

    @Id
    private String id;

    @Column(nullable = false)
    @NotBlank(message = "Customer number is required")
    private String customerNumber;

    @Column(nullable = false)
    private String ownerUid;

    @Column(nullable = false)
    private String password; // Should be hashed!

    @Column(nullable = false)
    @NotBlank(message = "Name is required")
    private String name;

    @Column(nullable = false)
    @NotBlank(message = "Email is required")
    @Email(message = "Email should be valid")
    private String email;

    private String role = "user";

    @Column(nullable = false)
    private Double balance = 1000.0;

    @Column(unique = true, nullable = false)
    private String accountNumber;

    @Column(nullable = false)
    private String currency = "USD";

    @Column(nullable = false)
    private String status = "active";

    @Column(nullable = false)
    private Boolean isPrimary = true;

    @PrePersist
    public void ensureId() {
        if (this.id == null) {
            this.id = java.util.UUID.randomUUID().toString();
        }
        if (this.accountNumber == null) {
            this.accountNumber = "ACC" + (int)(Math.random() * 1000000);
        }
    }
}
